<script lang="ts">
  import {
    ArrowLeft,
    Check,
    LayoutDashboard,
    Lock,
    Minus,
    Plus,
    Redo2,
    RotateCcw,
    Trash2,
    Undo2
  } from '@lucide/svelte';
  import { onDestroy } from 'svelte';
  import {
    editor,
    GRID_SIZE,
    metresToPixels,
    pixelsToMetres,
    roomSetupOptions,
    selectedProposedRoom,
    selectedRoom,
    selectedWall
  } from '$lib/editor/editorStore';
  import type { PlanBounds, ResizeHandle } from '$lib/editor/editorStore';
  import type {
    Opening,
    PlanRect,
    ProposedRoom,
    Room,
    SetupRoomKind,
    Wall
  } from '$lib/domain/types';

  const CANVAS_WIDTH = 960;
  const CANVAS_HEIGHT = 620;
  const CANVAS_PADDING = GRID_SIZE * 2;

  let canvas: SVGSVGElement;
  let interaction:
    | {
        mode: 'move';
        target: 'room' | 'proposed-room';
        roomId: string;
        offsetX: number;
        offsetY: number;
        historyCaptured: boolean;
      }
    | {
        mode: 'resize';
        target: 'room' | 'proposed-room';
        roomId: string;
        handle: ResizeHandle;
        historyCaptured: boolean;
      }
    | null = null;
  let addRoomMenuOpen = false;
  let suppressNextCanvasClick = false;
  let suppressCanvasClickTimer: ReturnType<typeof setTimeout> | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let wallMenu: {
    wallId: string;
    x: number;
    y: number;
    offset: number;
  } | null = null;

  let counts = Object.fromEntries(
    roomSetupOptions.map((option) => [option.kind, 0])
  ) as Record<SetupRoomKind, number>;
  let wholeAreaWidth = '6.00';
  let wholeAreaLength = '8.00';
  let proposedMeasurementRoomId: string | null = null;
  let proposedMeasurementEditing: 'width' | 'height' | null = null;
  let proposedWidthDraft = '';
  let proposedDepthDraft = '';

  const roomFillClasses: Record<Room['type'], string> = {
    bedroom: 'fill-[#dfeadf]',
    kitchen: 'fill-[#e8e1d3]',
    living: 'fill-[#dbe7ef]',
    wet: 'fill-[#dce5ee]',
    utility: 'fill-[#e5e0eb]',
    generic: 'fill-[#e8ecef]'
  };

  const statusClasses: Record<typeof $editor.saveState, string> = {
    saved: 'text-[#6b7682]',
    saving: 'text-[#996515]',
    offline: 'text-[#a33a3a]'
  };

  const handleCursors: Record<ResizeHandle, string> = {
    n: 'cursor-n-resize',
    e: 'cursor-e-resize',
    s: 'cursor-s-resize',
    w: 'cursor-w-resize',
    ne: 'cursor-ne-resize',
    se: 'cursor-se-resize',
    sw: 'cursor-sw-resize',
    nw: 'cursor-nw-resize'
  };

  $: totalRooms = Object.values(counts).reduce((sum, count) => sum + count, 0);
  $: measuredRooms = $editor.inventory.filter((room) => room.measured).length;
  $: isBaselineMode = $editor.activeMode === 'baseline';
  $: isScenarioMode = $editor.activeMode === 'scenario';
  $: isLockedBaseline = Boolean($editor.lockedBaseline);
  $: lockedBounds = $editor.lockedBaseline?.bounds ?? null;
  $: canvasViewport = canvasViewportFor(
    [
      ...$editor.plan.rooms,
      ...$editor.plan.proposedRooms,
      ...(isScenarioMode ? $editor.baselinePlan.rooms : [])
    ],
    lockedBounds
  );
  $: canEditGeometry = isScenarioMode || !isLockedBaseline;
  $: canEditWalls = isScenarioMode || !isLockedBaseline;
  $: activeProject =
    $editor.baselines.find(
      (baseline) =>
        baseline.id === ($editor.activeBaselineId ?? $editor.lockedBaseline?.id)
    ) ?? null;
  $: activeScenario =
    activeProject?.scenarios.find(
      (scenario) => scenario.id === $editor.activeScenarioId
    ) ?? null;
  $: projectTitle =
    activeProject?.name ??
    $editor.lockedBaseline?.name ??
    $editor.draftProjectName;
  $: modeTitle = isScenarioMode
    ? (activeScenario?.name ?? 'Scenario')
    : 'Baseline';
  $: modeSubtitle = isScenarioMode
    ? 'Proposed layout'
    : isLockedBaseline
      ? 'Locked existing layout'
      : 'Draft existing layout';
  $: wholeAreaPreview = previewWholeArea(
    Number(wholeAreaWidth),
    Number(wholeAreaLength)
  );
  $: if ($selectedProposedRoom?.id !== proposedMeasurementRoomId) {
    proposedMeasurementRoomId = $selectedProposedRoom?.id ?? null;
    proposedMeasurementEditing = null;
    proposedWidthDraft = $selectedProposedRoom
      ? pixelsToMetres($selectedProposedRoom.width).toFixed(2)
      : '';
    proposedDepthDraft = $selectedProposedRoom
      ? pixelsToMetres($selectedProposedRoom.height).toFixed(2)
      : '';
  }
  $: if ($selectedProposedRoom && proposedMeasurementEditing !== 'width') {
    proposedWidthDraft = pixelsToMetres($selectedProposedRoom.width).toFixed(2);
  }
  $: if ($selectedProposedRoom && proposedMeasurementEditing !== 'height') {
    proposedDepthDraft = pixelsToMetres($selectedProposedRoom.height).toFixed(
      2
    );
  }

  function scheduleSaved() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => editor.markSaved(), 450);
  }

  function countRoom(kind: SetupRoomKind, amount: number) {
    counts = {
      ...counts,
      [kind]: Math.max(0, counts[kind] + amount)
    };
  }

  function submitCounts() {
    editor.createInventory(counts);
  }

  function submitWholeArea() {
    const width = Number(wholeAreaWidth);
    const length = Number(wholeAreaLength);
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(length) ||
      width <= 0 ||
      length <= 0
    ) {
      return;
    }

    editor.startEditorFromWholeArea(
      metresToPixels(width),
      metresToPixels(length)
    );
    scheduleSaved();
  }

  function swapWholeAreaDimensions() {
    const nextWidth = wholeAreaLength;
    wholeAreaLength = wholeAreaWidth;
    wholeAreaWidth = nextWidth;
  }

  function previewWholeArea(width: number, length: number) {
    const safeWidth = Number.isFinite(width) && width > 0 ? width : 1;
    const safeLength = Number.isFinite(length) && length > 0 ? length : 1;
    const previewWidth = 260;
    const previewHeight = 190;
    const maxRectWidth = 190;
    const maxRectHeight = 120;
    const scale = Math.min(
      maxRectWidth / safeWidth,
      maxRectHeight / safeLength
    );
    const rectWidth = safeWidth * scale;
    const rectHeight = safeLength * scale;

    return {
      x: (previewWidth - rectWidth) / 2,
      y: 28 + (maxRectHeight - rectHeight) / 2,
      width: rectWidth,
      height: rectHeight,
      canvasWidth: previewWidth,
      canvasHeight: previewHeight,
      labelWidth: safeWidth,
      labelLength: safeLength,
      area: safeWidth * safeLength
    };
  }

  function updateInventoryMetres(
    roomId: string,
    field: 'width' | 'height',
    value: string
  ) {
    const metres = Number(value);
    if (!Number.isFinite(metres) || metres <= 0) return;

    editor.updateInventoryRoom(roomId, {
      [field]: metresToPixels(metres),
      measured: true
    });
  }

  function useSuggestedSize(roomId: string, kind: SetupRoomKind) {
    const option = roomSetupOptions.find(
      (candidate) => candidate.kind === kind
    );
    if (!option) return;

    editor.updateInventoryRoom(roomId, {
      width: option.width,
      height: option.height,
      measured: false
    });
  }

  function getCanvasPoint(event: MouseEvent | PointerEvent | DragEvent) {
    const point = canvas.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(canvas.getScreenCTM()?.inverse());
  }

  function pixelsFromMetres(value: string) {
    const metres = Number(value);
    if (!Number.isFinite(metres)) return null;

    return (metres / 0.25) * GRID_SIZE;
  }

  function updateProposedMeasurement(field: 'width' | 'height', value: string) {
    if (!$selectedProposedRoom) return;
    const pixels = pixelsFromMetres(value);
    if (pixels === null) return;

    editor.updateProposedRoom($selectedProposedRoom.id, {
      [field]: pixels
    });
    scheduleSaved();
  }

  function canvasViewportFor(
    rects: PlanRect[],
    bounds: PlanBounds | null
  ): PlanBounds {
    const visibleRects = bounds ? [...rects, bounds] : rects;
    if (visibleRects.length === 0) {
      return { x: 0, y: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT };
    }

    const left = Math.min(0, ...visibleRects.map((rect) => rect.x));
    const top = Math.min(0, ...visibleRects.map((rect) => rect.y));
    const right = Math.max(
      CANVAS_WIDTH,
      ...visibleRects.map((rect) => rect.x + rect.width)
    );
    const bottom = Math.max(
      CANVAS_HEIGHT,
      ...visibleRects.map((rect) => rect.y + rect.height)
    );
    const x = left < 0 ? left - CANVAS_PADDING : 0;
    const y = top < 0 ? top - CANVAS_PADDING : 0;

    return {
      x,
      y,
      width: right - x + CANVAS_PADDING,
      height: bottom - y + CANVAS_PADDING
    };
  }

  function handleRoomPointerDown(event: PointerEvent, room: Room) {
    event.stopPropagation();
    wallMenu = null;
    addRoomMenuOpen = false;
    editor.selectRoom(room.id);
    if (!canEditGeometry) return;

    const point = getCanvasPoint(event);
    interaction = {
      mode: 'move',
      target: 'room',
      roomId: room.id,
      offsetX: point.x - room.x,
      offsetY: point.y - room.y,
      historyCaptured: false
    };

    canvas.setPointerCapture(event.pointerId);
  }

  function handleProposedRoomPointerDown(
    event: PointerEvent,
    room: ProposedRoom
  ) {
    event.stopPropagation();
    wallMenu = null;
    addRoomMenuOpen = false;
    editor.selectProposedRoom(room.id);
    if (!isScenarioMode) return;

    const point = getCanvasPoint(event);
    interaction = {
      mode: 'move',
      target: 'proposed-room',
      roomId: room.id,
      offsetX: point.x - room.x,
      offsetY: point.y - room.y,
      historyCaptured: false
    };

    canvas.setPointerCapture(event.pointerId);
  }

  function handleResizePointerDown(
    event: PointerEvent,
    roomId: string,
    handle: ResizeHandle,
    target: 'room' | 'proposed-room' = 'room'
  ) {
    event.stopPropagation();
    addRoomMenuOpen = false;
    if (target === 'room' && !canEditGeometry) return;
    if (target === 'proposed-room' && !isScenarioMode) return;

    interaction = {
      mode: 'resize',
      target,
      roomId,
      handle,
      historyCaptured: false
    };
    if (target === 'proposed-room') {
      editor.selectProposedRoom(roomId);
    } else {
      editor.selectRoom(roomId);
    }
    canvas.setPointerCapture(event.pointerId);
  }

  function handleWallPointerDown(event: PointerEvent, wallId: string) {
    event.stopPropagation();
    addRoomMenuOpen = false;
    const wall = $editor.plan.walls.find(
      (candidate) => candidate.id === wallId
    );
    const point = getCanvasPoint(event);
    wallMenu = {
      wallId,
      x: event.clientX,
      y: event.clientY,
      offset: wall ? wallOffsetFromPoint(wall, point.x, point.y) : 0
    };
    editor.selectWall(wallId);
  }

  function handleCanvasPointerDown(event: PointerEvent) {
    if (event.target === canvas) {
      wallMenu = null;
      addRoomMenuOpen = false;
    }
  }

  function handleCanvasPointerMove(event: PointerEvent) {
    if (!interaction) return;

    const point = getCanvasPoint(event);

    const currentInteraction = interaction;
    if (!currentInteraction) return;

    if (currentInteraction.mode === 'move') {
      const x = point.x - currentInteraction.offsetX;
      const y = point.y - currentInteraction.offsetY;
      if (currentInteraction.target === 'proposed-room') {
        editor.moveProposedRoom(currentInteraction.roomId, x, y, {
          history: !currentInteraction.historyCaptured
        });
      } else {
        editor.moveRoom(currentInteraction.roomId, x, y, {
          history: !currentInteraction.historyCaptured
        });
      }
    } else {
      if (currentInteraction.target === 'proposed-room') {
        editor.resizeProposedRoom(
          currentInteraction.roomId,
          currentInteraction.handle,
          point.x,
          point.y,
          {
            history: !currentInteraction.historyCaptured
          }
        );
      } else {
        editor.resizeRoom(
          currentInteraction.roomId,
          currentInteraction.handle,
          point.x,
          point.y,
          {
            history: !currentInteraction.historyCaptured
          }
        );
      }
    }

    currentInteraction.historyCaptured = true;
    scheduleSaved();
  }

  function handleCanvasPointerUp(event: PointerEvent) {
    if (interaction) {
      suppressNextCanvasClick = true;
      clearTimeout(suppressCanvasClickTimer);
      suppressCanvasClickTimer = setTimeout(() => {
        suppressNextCanvasClick = false;
      }, 0);
    }

    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }

    interaction = null;
  }

  function handleCanvasClick() {
    if (suppressNextCanvasClick) {
      suppressNextCanvasClick = false;
      clearTimeout(suppressCanvasClickTimer);
      return;
    }

    wallMenu = null;
    addRoomMenuOpen = false;
    editor.selectRoom(null);
    editor.selectProposedRoom(null);
  }

  function handleRoomClick(event: MouseEvent) {
    suppressNextCanvasClick = false;
    clearTimeout(suppressCanvasClickTimer);
    event.stopPropagation();
  }

  function handleWallClick(event: MouseEvent) {
    suppressNextCanvasClick = false;
    clearTimeout(suppressCanvasClickTimer);
    event.stopPropagation();
  }

  function handleCanvasKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      wallMenu = null;
      addRoomMenuOpen = false;
      editor.selectRoom(null);
      editor.selectProposedRoom(null);
    }
  }

  function handleRoomKeydown(event: KeyboardEvent, roomId: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      wallMenu = null;
      addRoomMenuOpen = false;
      editor.selectRoom(roomId);
    }
  }

  function handleProposedRoomKeydown(event: KeyboardEvent, roomId: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      wallMenu = null;
      addRoomMenuOpen = false;
      editor.selectProposedRoom(roomId);
    }
  }

  function handleWallKeydown(event: KeyboardEvent, wallId: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      wallMenu = null;
      addRoomMenuOpen = false;
      editor.selectWall(wallId);
    }
  }

  function wallOffsetFromPoint(wall: Wall, x: number, y: number) {
    return wall.x1 === wall.x2
      ? Math.abs(y - Math.min(wall.y1, wall.y2))
      : Math.abs(x - Math.min(wall.x1, wall.x2));
  }

  function wallOpenings(wall: Wall) {
    return $editor.plan.openings.filter(
      (opening) => opening.wallId === wall.id
    );
  }

  function openingPosition(wall: Wall, opening: Opening) {
    const isVertical = wall.x1 === wall.x2;
    const length = isVertical
      ? Math.abs(wall.y2 - wall.y1)
      : Math.abs(wall.x2 - wall.x1);
    const offset = Math.min(
      Math.max(0, opening.offset),
      Math.max(0, length - opening.width)
    );

    return isVertical
      ? {
          x1: wall.x1,
          y1: Math.min(wall.y1, wall.y2) + offset,
          x2: wall.x2,
          y2: Math.min(wall.y1, wall.y2) + offset + opening.width
        }
      : {
          x1: Math.min(wall.x1, wall.x2) + offset,
          y1: wall.y1,
          x2: Math.min(wall.x1, wall.x2) + offset + opening.width,
          y2: wall.y2
        };
  }

  function wallHitbox(wall: Wall) {
    const thickness = 18;
    const half = thickness / 2;
    const isVertical = wall.x1 === wall.x2;

    return isVertical
      ? {
          x: wall.x1 - half,
          y: Math.min(wall.y1, wall.y2),
          width: thickness,
          height: Math.abs(wall.y2 - wall.y1)
        }
      : {
          x: Math.min(wall.x1, wall.x2),
          y: wall.y1 - half,
          width: Math.abs(wall.x2 - wall.x1),
          height: thickness
        };
  }

  function resizeHandles(
    room: PlanRect
  ): { handle: ResizeHandle; x: number; y: number }[] {
    const midX = room.x + room.width / 2;
    const midY = room.y + room.height / 2;
    const right = room.x + room.width;
    const bottom = room.y + room.height;

    return [
      { handle: 'nw', x: room.x, y: room.y },
      { handle: 'n', x: midX, y: room.y },
      { handle: 'ne', x: right, y: room.y },
      { handle: 'e', x: right, y: midY },
      { handle: 'se', x: right, y: bottom },
      { handle: 's', x: midX, y: bottom },
      { handle: 'sw', x: room.x, y: bottom },
      { handle: 'w', x: room.x, y: midY }
    ];
  }

  onDestroy(() => {
    clearTimeout(saveTimer);
    clearTimeout(suppressCanvasClickTimer);
  });
</script>

<svelte:head>
  <title>Renoplan</title>
  <meta
    name="description"
    content="Conceptual renovation planner for creating and comparing room-based floor plans."
  />
</svelte:head>

{#if $editor.setupStep === 'dashboard'}
  <main class="min-h-screen bg-[#f4f6f8] text-[#17202a]">
    <section class="mx-auto grid max-w-6xl gap-7 px-6 py-10">
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div class="grid gap-2">
          <p
            class="m-0 text-[0.78rem] font-bold tracking-normal text-[#6b7682] uppercase"
          >
            Renoplan dashboard
          </p>
          <h1
            class="m-0 max-w-3xl text-[2rem] leading-[1.1] font-bold tracking-normal"
          >
            Renovation projects
          </h1>
        </div>
        <button
          class="inline-flex min-h-11 items-center gap-2 rounded-md bg-[#0f766e] px-4 text-sm font-bold text-white"
          type="button"
          onclick={() => editor.startNewBaseline()}
        >
          <Plus size={18} />
          New project
        </button>
      </header>

      {#if $editor.draftPlan && $editor.draftPlan.rooms.length > 0}
        <section
          class="grid gap-3 rounded-md border border-[#d8dee5] bg-white p-4"
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="grid gap-1">
              <h2 class="m-0 text-[1rem] font-bold tracking-normal">
                Draft project
              </h2>
              <p class="m-0 text-sm text-[#66717e]">
                {projectTitle} has {$editor.draftPlan.rooms.length} rooms waiting
                to be locked.
              </p>
            </div>
            <button
              class="inline-flex min-h-10 items-center gap-2 rounded-md border border-[#c8d1dc] bg-[#f8fafc] px-3 text-sm font-bold text-[#17202a]"
              type="button"
              onclick={() => editor.openDraftProject()}
            >
              Continue draft
            </button>
          </div>
        </section>
      {/if}

      <section class="grid gap-3">
        <h2 class="m-0 text-[1.1rem] font-bold tracking-normal">Projects</h2>
        {#if $editor.baselines.length === 0}
          <div
            class="grid gap-3 rounded-md border border-[#d8dee5] bg-white p-5"
          >
            <h3 class="m-0 text-[1rem] font-bold tracking-normal">
              No projects yet
            </h3>
            <p class="m-0 max-w-2xl text-sm leading-6 text-[#66717e]">
              Create a project, capture the existing layout, then lock its
              baseline before exploring renovation scenarios.
            </p>
          </div>
        {:else}
          <div
            class="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4"
          >
            {#each $editor.baselines as baseline (baseline.id)}
              <article
                class="grid gap-4 rounded-md border border-[#d8dee5] bg-white p-4"
              >
                <div class="grid gap-1">
                  <h3 class="m-0 text-[1rem] font-bold tracking-normal">
                    {baseline.name}
                  </h3>
                  <p class="m-0 text-sm text-[#66717e]">
                    Locked baseline · {baseline.scenarios.length}
                    scenarios
                  </p>
                </div>

                <div class="flex flex-wrap gap-2">
                  <button
                    class="inline-flex min-h-9 items-center gap-2 rounded-md bg-[#0f766e] px-3 text-sm font-bold text-white"
                    type="button"
                    onclick={() => editor.openBaseline(baseline.id)}
                  >
                    Open project
                  </button>
                </div>
              </article>
            {/each}
          </div>
        {/if}
      </section>
    </section>
  </main>
{:else if $editor.setupStep !== 'editor'}
  <main class="min-h-screen bg-[#f4f6f8] text-[#17202a]">
    <section
      class="mx-auto grid min-h-screen max-w-5xl content-start gap-8 px-6 py-10"
    >
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div class="grid gap-3">
          <p
            class="m-0 text-[0.78rem] font-bold tracking-normal text-[#6b7682] uppercase"
          >
            Create project
          </p>
          <h1
            class="m-0 max-w-3xl text-[2rem] leading-[1.1] font-bold tracking-normal"
          >
            Start with the project and its existing layout.
          </h1>
        </div>
        <button
          class="inline-flex min-h-10 items-center gap-2 rounded-md border border-[#c8d1dc] bg-white px-3 text-sm font-bold text-[#17202a]"
          type="button"
          onclick={() => editor.openDashboard()}
        >
          <LayoutDashboard size={17} />
          Dashboard
        </button>
      </header>

      {#if $editor.setupStep === 'project-details'}
        <section class="grid max-w-xl gap-5">
          <div class="grid gap-1">
            <h2 class="m-0 text-[1.1rem] font-bold tracking-normal">
              Project details
            </h2>
            <p class="m-0 text-sm text-[#5f6c7b]">
              Name this renovation before capturing the existing layout.
            </p>
          </div>

          <label class="grid gap-1 text-sm font-bold text-[#344153]">
            Project name
            <input
              class="min-h-11 rounded-md border border-[#c8d1dc] bg-white px-3 text-[#17202a]"
              value={$editor.draftProjectName}
              oninput={(event) =>
                editor.updateDraftProjectName(event.currentTarget.value)}
            />
          </label>

          <div class="flex justify-end">
            <button
              class="inline-flex min-h-11 items-center gap-2 rounded-md bg-[#0f766e] px-4 text-sm font-bold text-white"
              type="button"
              onclick={() => editor.continueProjectDetails()}
            >
              <Check size={18} />
              Continue
            </button>
          </div>
        </section>
      {:else if $editor.setupStep === 'counts'}
        <section class="grid gap-5">
          <div
            class="grid gap-3 rounded-md border border-[#d8dee5] bg-white p-4"
          >
            <div class="grid gap-1">
              <h2 class="m-0 text-[1.1rem] font-bold tracking-normal">
                Start with the whole area
              </h2>
              <p class="m-0 text-sm text-[#5f6c7b]">
                Enter the overall workable area when you know the footprint
                before the individual room sizes.
              </p>
            </div>
            <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div
                class="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] items-end gap-3"
              >
                <label class="grid gap-1 text-sm font-bold text-[#344153]">
                  Width m
                  <input
                    class="min-h-10 rounded-md border border-[#c8d1dc] bg-white px-3 text-[#17202a]"
                    inputmode="decimal"
                    min="0.5"
                    step="0.01"
                    type="number"
                    value={wholeAreaWidth}
                    oninput={(event) =>
                      (wholeAreaWidth = event.currentTarget.value)}
                  />
                </label>
                <label class="grid gap-1 text-sm font-bold text-[#344153]">
                  Length m
                  <input
                    class="min-h-10 rounded-md border border-[#c8d1dc] bg-white px-3 text-[#17202a]"
                    inputmode="decimal"
                    min="0.5"
                    step="0.01"
                    type="number"
                    value={wholeAreaLength}
                    oninput={(event) =>
                      (wholeAreaLength = event.currentTarget.value)}
                  />
                </label>
                <button
                  class="inline-flex min-h-10 items-center justify-center rounded-md border border-[#c8d1dc] bg-[#f8fafc] px-4 text-sm font-bold text-[#17202a]"
                  type="button"
                  onclick={swapWholeAreaDimensions}
                >
                  Swap width/length
                </button>
                <button
                  class="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-[#0f766e] px-4 text-sm font-bold text-white"
                  type="button"
                  onclick={submitWholeArea}
                >
                  <Check size={18} />
                  Create plan
                </button>
              </div>

              <figure
                class="m-0 grid justify-items-center gap-2 rounded-md bg-[#f8fafc] p-3"
                aria-label="Whole area orientation preview"
              >
                <svg
                  class="h-auto w-full max-w-[260px]"
                  viewBox={`0 0 ${wholeAreaPreview.canvasWidth} ${wholeAreaPreview.canvasHeight}`}
                  role="img"
                  aria-label="Width runs left to right. Length runs top to bottom."
                >
                  <defs>
                    <marker
                      id="area-preview-arrow"
                      viewBox="0 0 10 10"
                      refX="5"
                      refY="5"
                      markerWidth="5"
                      markerHeight="5"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="#0f766e" />
                    </marker>
                  </defs>
                  <rect
                    x={wholeAreaPreview.x}
                    y={wholeAreaPreview.y}
                    width={wholeAreaPreview.width}
                    height={wholeAreaPreview.height}
                    fill="#e8ecef"
                    stroke="#17202a"
                    stroke-width="2"
                    rx="3"
                  />
                  <line
                    x1={wholeAreaPreview.x}
                    y1={wholeAreaPreview.y + wholeAreaPreview.height + 18}
                    x2={wholeAreaPreview.x + wholeAreaPreview.width}
                    y2={wholeAreaPreview.y + wholeAreaPreview.height + 18}
                    stroke="#0f766e"
                    stroke-width="2"
                    marker-start="url(#area-preview-arrow)"
                    marker-end="url(#area-preview-arrow)"
                  />
                  <text
                    class="fill-[#0f766e] text-[12px] font-bold"
                    x={wholeAreaPreview.x + wholeAreaPreview.width / 2}
                    y={wholeAreaPreview.y + wholeAreaPreview.height + 38}
                    text-anchor="middle"
                  >
                    Width {wholeAreaPreview.labelWidth.toFixed(2)}m
                  </text>
                  <line
                    x1={wholeAreaPreview.x - 18}
                    y1={wholeAreaPreview.y}
                    x2={wholeAreaPreview.x - 18}
                    y2={wholeAreaPreview.y + wholeAreaPreview.height}
                    stroke="#0f766e"
                    stroke-width="2"
                    marker-start="url(#area-preview-arrow)"
                    marker-end="url(#area-preview-arrow)"
                  />
                  <text
                    class="fill-[#0f766e] text-[12px] font-bold"
                    x={wholeAreaPreview.x - 36}
                    y={wholeAreaPreview.y + wholeAreaPreview.height / 2}
                    text-anchor="middle"
                    transform={`rotate(-90 ${wholeAreaPreview.x - 36} ${wholeAreaPreview.y + wholeAreaPreview.height / 2})`}
                  >
                    Length {wholeAreaPreview.labelLength.toFixed(2)}m
                  </text>
                </svg>
                <figcaption
                  class="text-center text-xs font-bold text-[#66717e]"
                >
                  Preview: width is horizontal, length is vertical · {wholeAreaPreview.area.toFixed(
                    2
                  )}m²
                </figcaption>
              </figure>
            </div>
          </div>

          <div class="flex items-end justify-between gap-4">
            <div class="grid gap-1">
              <h2 class="m-0 text-[1.1rem] font-bold tracking-normal">
                Or count each room
              </h2>
              <p class="m-0 text-sm text-[#5f6c7b]">
                Add only rooms present in the current house.
              </p>
            </div>
            <div class="text-sm font-bold text-[#435061]">
              {totalRooms} rooms
            </div>
          </div>

          <div
            class="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-3"
          >
            {#each roomSetupOptions as option (option.kind)}
              <div
                class="grid min-h-[104px] gap-3 rounded-md border border-[#d8dee5] bg-white p-4"
              >
                <div class="flex items-center justify-between gap-3">
                  <span class="font-bold">{option.label}</span>
                  <span
                    class="min-w-6 text-right text-sm font-bold text-[#435061]"
                  >
                    {counts[option.kind]}
                  </span>
                </div>
                <div class="flex items-center gap-2">
                  <button
                    class="grid size-9 place-items-center rounded-md border border-[#c8d1dc] bg-[#f8fafc] text-[#17202a] disabled:cursor-not-allowed disabled:opacity-40"
                    type="button"
                    aria-label={`Remove ${option.label}`}
                    data-testid={`remove-${option.kind}`}
                    disabled={counts[option.kind] === 0}
                    onclick={() => countRoom(option.kind, -1)}
                  >
                    <Minus size={17} />
                  </button>
                  <button
                    class="grid size-9 place-items-center rounded-md border border-[#c8d1dc] bg-[#f8fafc] text-[#17202a]"
                    type="button"
                    aria-label={`Add ${option.label}`}
                    data-testid={`add-${option.kind}`}
                    onclick={() => countRoom(option.kind, 1)}
                  >
                    <Plus size={17} />
                  </button>
                </div>
              </div>
            {/each}
          </div>

          <div class="flex justify-end">
            <button
              class="inline-flex min-h-11 items-center gap-2 rounded-md bg-[#0f766e] px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-45"
              type="button"
              disabled={totalRooms === 0}
              onclick={submitCounts}
            >
              <Check size={18} />
              Continue
            </button>
          </div>
        </section>
      {:else}
        <section class="grid gap-5">
          <div class="flex items-end justify-between gap-4">
            <div class="grid gap-1">
              <h2 class="m-0 text-[1.1rem] font-bold tracking-normal">
                Add measurements
              </h2>
              <p class="m-0 text-sm text-[#5f6c7b]">
                Use known dimensions, or keep the suggested size for now.
              </p>
            </div>
            <div class="text-sm font-bold text-[#435061]">
              {measuredRooms} of {$editor.inventory.length} measured
            </div>
          </div>

          <div class="grid gap-2">
            {#each $editor.inventory as room (room.id)}
              <div
                class="grid grid-cols-[minmax(140px,1fr)_128px_128px_auto] items-end gap-3 rounded-md border border-[#d8dee5] bg-white p-3"
              >
                <label class="grid gap-1 text-sm font-bold text-[#344153]">
                  Name
                  <input
                    class="min-h-10 rounded-md border border-[#c8d1dc] bg-white px-3 text-[#17202a]"
                    value={room.label}
                    oninput={(event) =>
                      editor.updateInventoryRoom(room.id, {
                        label: event.currentTarget.value
                      })}
                  />
                </label>
                <label class="grid gap-1 text-sm font-bold text-[#344153]">
                  Width m
                  <input
                    class="min-h-10 rounded-md border border-[#c8d1dc] bg-white px-3 text-[#17202a]"
                    inputmode="decimal"
                    min="0.5"
                    step="0.01"
                    type="number"
                    value={pixelsToMetres(room.width).toFixed(2)}
                    oninput={(event) =>
                      updateInventoryMetres(
                        room.id,
                        'width',
                        event.currentTarget.value
                      )}
                  />
                </label>
                <label class="grid gap-1 text-sm font-bold text-[#344153]">
                  Depth m
                  <input
                    class="min-h-10 rounded-md border border-[#c8d1dc] bg-white px-3 text-[#17202a]"
                    inputmode="decimal"
                    min="0.5"
                    step="0.01"
                    type="number"
                    value={pixelsToMetres(room.height).toFixed(2)}
                    oninput={(event) =>
                      updateInventoryMetres(
                        room.id,
                        'height',
                        event.currentTarget.value
                      )}
                  />
                </label>
                <button
                  class="min-h-10 rounded-md border border-[#c8d1dc] bg-[#f8fafc] px-3 text-sm font-bold text-[#17202a]"
                  type="button"
                  onclick={() => useSuggestedSize(room.id, room.kind)}
                >
                  Suggested
                </button>
              </div>
            {/each}
          </div>

          <div class="flex items-center justify-between gap-4">
            <button
              class="inline-flex min-h-11 items-center gap-2 rounded-md border border-[#c8d1dc] bg-white px-4 text-sm font-bold text-[#17202a]"
              type="button"
              onclick={editor.returnToCounts}
            >
              <ArrowLeft size={18} />
              Counts
            </button>
            <button
              class="inline-flex min-h-11 items-center gap-2 rounded-md bg-[#0f766e] px-4 text-sm font-bold text-white"
              type="button"
              onclick={() => {
                editor.startEditorFromInventory();
                scheduleSaved();
              }}
            >
              <Check size={18} />
              Create plan
            </button>
          </div>
        </section>
      {/if}
    </section>
  </main>
{:else}
  <main
    class="grid min-h-screen grid-cols-[320px_minmax(0,1fr)] bg-[#f4f6f8] text-[#17202a]"
  >
    <aside class="flex flex-col gap-5 border-r border-[#d8dee5] bg-white p-6">
      <div>
        <p
          class="mb-2 text-[0.78rem] font-bold tracking-normal text-[#6b7682] uppercase"
        >
          {isLockedBaseline ? 'Project workspace' : 'Baseline creation'}
        </p>
        <h1 class="m-0 text-[1.35rem] leading-[1.2] font-bold tracking-normal">
          {projectTitle}
        </h1>
      </div>

      {#if isLockedBaseline && activeProject}
        <section class="grid gap-3">
          <button
            class="inline-flex min-h-10 items-center gap-2 rounded-md border border-[#c8d1dc] bg-[#f8fafc] px-3 text-sm font-bold text-[#17202a]"
            type="button"
            onclick={() => editor.openDashboard()}
          >
            <LayoutDashboard size={17} />
            All projects
          </button>

          <div class="grid gap-2">
            <h2 class="m-0 text-[0.92rem] font-bold tracking-normal">
              Existing layout
            </h2>
            <button
              class={`min-h-10 rounded-md px-3 text-left text-sm font-bold ${
                isBaselineMode
                  ? 'bg-[#17202a] text-white'
                  : 'border border-[#d8dee5] bg-[#f8fafc] text-[#17202a]'
              }`}
              type="button"
              onclick={() => editor.openBaseline(activeProject.id)}
            >
              Baseline
            </button>
          </div>

          <div class="grid gap-2">
            <div class="flex items-center justify-between gap-3">
              <h2 class="m-0 text-[0.92rem] font-bold tracking-normal">
                Renovation scenarios
              </h2>
              {#if !isBaselineMode}
                <button
                  class="grid size-8 place-items-center rounded-md bg-[#0f766e] text-white"
                  type="button"
                  aria-label="Create scenario"
                  onclick={() => {
                    editor.createRenovationPlan();
                    scheduleSaved();
                  }}
                >
                  <Plus size={16} />
                </button>
              {/if}
            </div>
            {#if activeProject.scenarios.length === 0}
              <p class="m-0 text-sm leading-6 text-[#66717e]">
                Create a scenario when you are ready to explore changes.
              </p>
            {:else}
              {#each activeProject.scenarios as scenario (scenario.id)}
                <button
                  class={`min-h-10 rounded-md px-3 text-left text-sm font-bold ${
                    scenario.id === $editor.activeScenarioId
                      ? 'bg-[#17202a] text-white'
                      : 'border border-[#d8dee5] bg-[#f8fafc] text-[#17202a]'
                  }`}
                  type="button"
                  onclick={() =>
                    editor.openScenario(activeProject.id, scenario.id)}
                >
                  {scenario.name}
                </button>
              {/each}
            {/if}
            {#if isBaselineMode}
              <button
                class="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-[#0f766e] px-3 text-sm font-bold text-white"
                type="button"
                onclick={() => {
                  editor.createRenovationPlan();
                  scheduleSaved();
                }}
              >
                <Plus size={16} />
                Create scenario
              </button>
            {/if}
          </div>
        </section>
      {:else}
        <section class="grid gap-3">
          <h2 class="m-0 text-[0.92rem] font-bold tracking-normal">
            Setup summary
          </h2>
          <dl class="m-0 grid gap-[9px]">
            <div class="flex items-baseline justify-between gap-4">
              <dt class="text-[0.78rem] font-bold text-[#66717e] uppercase">
                Rooms
              </dt>
              <dd class="m-0 text-sm font-bold text-[#17202a]">
                {$editor.plan.rooms.length}
              </dd>
            </div>
            <div class="flex items-baseline justify-between gap-4">
              <dt class="text-[0.78rem] font-bold text-[#66717e] uppercase">
                Measured
              </dt>
              <dd class="m-0 text-sm font-bold text-[#17202a]">
                {measuredRooms}
              </dd>
            </div>
          </dl>
          <button
            class="inline-flex min-h-10 items-center gap-2 rounded-md border border-[#c8d1dc] bg-[#f8fafc] px-3 text-sm font-bold text-[#17202a]"
            type="button"
            onclick={editor.returnToSetup}
          >
            <ArrowLeft size={17} />
            Edit setup
          </button>
        </section>
      {/if}

      {#if isScenarioMode}
        <section class="grid gap-3">
          <h2 class="m-0 text-[0.92rem] font-bold tracking-normal">
            Scenario details
          </h2>
          {#if activeScenario}
            <label class="grid gap-1 text-xs font-bold text-[#66717e]">
              Scenario name
              <input
                class="min-h-9 rounded-md border border-[#c8d1dc] bg-white px-2 text-sm text-[#17202a]"
                value={activeScenario.name}
                oninput={(event) => {
                  editor.renameScenario(
                    activeScenario.id,
                    event.currentTarget.value
                  );
                  scheduleSaved();
                }}
              />
            </label>
          {/if}
          <label class="flex items-center gap-[7px] text-sm text-[#344153]">
            <input
              class="size-4"
              type="checkbox"
              checked={$editor.showReferenceBackground}
              onchange={() => {
                editor.toggleReferenceBackground();
                scheduleSaved();
              }}
            />
            Reference background
          </label>
        </section>
      {:else if !isLockedBaseline}
        <section class="grid gap-3">
          <h2 class="m-0 text-[0.92rem] font-bold tracking-normal">Next</h2>
          <ol class="m-0 grid gap-2.5 pl-5 text-[#66717e]">
            <li class="font-bold text-[#17202a]">Drag rooms into position</li>
            <li>Resize rooms if measurements change</li>
            <li>Join room edges to create shared walls</li>
            <li>Lock baseline when the footprint looks right</li>
          </ol>
        </section>
      {/if}

      {#if $selectedRoom}
        <section class="grid gap-3" aria-live="polite">
          <h2 class="m-0 text-[0.92rem] font-bold tracking-normal">
            Selected room
          </h2>
          <dl class="m-0 grid gap-[9px]">
            <div class="flex items-baseline justify-between gap-4">
              <dt class="text-[0.78rem] font-bold text-[#66717e] uppercase">
                Name
              </dt>
              <dd class="m-0 text-sm font-bold text-[#17202a]">
                {$selectedRoom.name}
              </dd>
            </div>
            <div class="flex items-baseline justify-between gap-4">
              <dt class="text-[0.78rem] font-bold text-[#66717e] uppercase">
                Size
              </dt>
              <dd class="m-0 text-sm font-bold text-[#17202a]">
                {pixelsToMetres($selectedRoom.width).toFixed(2)}m x
                {pixelsToMetres($selectedRoom.height).toFixed(2)}m
              </dd>
            </div>
          </dl>
        </section>
      {/if}

      {#if $selectedProposedRoom}
        <section class="grid gap-3" aria-live="polite">
          <div class="flex items-center justify-between gap-3">
            <h2 class="m-0 text-[0.92rem] font-bold tracking-normal">
              Proposed room
            </h2>
            <span
              class="rounded-sm bg-[#e8f3f1] px-2 py-1 text-[0.72rem] font-bold text-[#0f766e] uppercase"
            >
              Overlay
            </span>
          </div>
          <label class="grid gap-1 text-xs font-bold text-[#66717e]">
            Room name
            <input
              class="min-h-9 rounded-md border border-[#c8d1dc] bg-white px-2 text-sm text-[#17202a]"
              value={$selectedProposedRoom.name}
              oninput={(event) => {
                editor.updateProposedRoom($selectedProposedRoom.id, {
                  name: event.currentTarget.value
                });
                scheduleSaved();
              }}
            />
          </label>
          <div class="grid min-w-0 grid-cols-2 gap-2">
            <label class="grid min-w-0 gap-1 text-xs font-bold text-[#66717e]">
              Width m
              <input
                class="min-h-9 min-w-0 rounded-md border border-[#c8d1dc] bg-white px-2 text-sm text-[#17202a]"
                inputmode="decimal"
                min="0.5"
                step="0.01"
                type="number"
                value={proposedWidthDraft}
                onfocus={() => {
                  proposedMeasurementEditing = 'width';
                }}
                onblur={() => {
                  proposedMeasurementEditing = null;
                }}
                oninput={(event) => {
                  proposedWidthDraft = event.currentTarget.value;
                  updateProposedMeasurement('width', proposedWidthDraft);
                }}
              />
            </label>
            <label class="grid min-w-0 gap-1 text-xs font-bold text-[#66717e]">
              Depth m
              <input
                class="min-h-9 min-w-0 rounded-md border border-[#c8d1dc] bg-white px-2 text-sm text-[#17202a]"
                inputmode="decimal"
                min="0.5"
                step="0.01"
                type="number"
                value={proposedDepthDraft}
                onfocus={() => {
                  proposedMeasurementEditing = 'height';
                }}
                onblur={() => {
                  proposedMeasurementEditing = null;
                }}
                oninput={(event) => {
                  proposedDepthDraft = event.currentTarget.value;
                  updateProposedMeasurement('height', proposedDepthDraft);
                }}
              />
            </label>
          </div>
          <button
            class="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-[#c8d1dc] bg-[#f8fafc] px-3 text-sm font-bold text-[#17202a]"
            type="button"
            onclick={() => {
              editor.deleteProposedRoom($selectedProposedRoom.id);
              scheduleSaved();
            }}
          >
            <Trash2 size={16} />
            Delete room
          </button>
        </section>
      {/if}

      {#if $selectedWall}
        <section class="grid gap-3" aria-live="polite">
          <h2 class="m-0 text-[0.92rem] font-bold tracking-normal">
            Selected wall
          </h2>
          <dl class="m-0 grid gap-[9px]">
            <div class="flex items-baseline justify-between gap-4">
              <dt class="text-[0.78rem] font-bold text-[#66717e] uppercase">
                Type
              </dt>
              <dd class="m-0 text-sm font-bold text-[#17202a]">
                {$selectedWall.kind}
              </dd>
            </div>
            <div class="flex items-baseline justify-between gap-4">
              <dt class="text-[0.78rem] font-bold text-[#66717e] uppercase">
                Length
              </dt>
              <dd class="m-0 text-sm font-bold text-[#17202a]">
                {pixelsToMetres(
                  Math.hypot(
                    $selectedWall.x2 - $selectedWall.x1,
                    $selectedWall.y2 - $selectedWall.y1
                  )
                ).toFixed(2)}m
              </dd>
            </div>
            <div class="flex items-baseline justify-between gap-4">
              <dt class="text-[0.78rem] font-bold text-[#66717e] uppercase">
                Openings
              </dt>
              <dd
                class="m-0 text-sm font-bold text-[#17202a]"
                data-testid="selected-wall-openings"
              >
                {wallOpenings($selectedWall).length}
              </dd>
            </div>
          </dl>
          {#if wallOpenings($selectedWall).length > 0}
            <div class="grid gap-2">
              {#each wallOpenings($selectedWall) as opening (opening.id)}
                {@const length = Math.hypot(
                  $selectedWall.x2 - $selectedWall.x1,
                  $selectedWall.y2 - $selectedWall.y1
                )}
                {@const maxOffset = Math.max(0, length - opening.width)}
                <div class="grid gap-2 rounded-md border border-[#d8dee5] p-3">
                  <div class="flex items-center justify-between gap-3">
                    <strong class="text-sm">Door</strong>
                    <span class="text-xs font-bold text-[#66717e]">
                      {pixelsToMetres(opening.offset).toFixed(2)}m from start
                    </span>
                  </div>
                  <label class="grid gap-1 text-xs font-bold text-[#66717e]">
                    Position
                    <input
                      type="range"
                      min="0"
                      max={maxOffset}
                      step={$editor.snapToGrid ? GRID_SIZE : 1}
                      value={opening.offset}
                      oninput={(event) => {
                        editor.updateOpening(opening.id, {
                          offset: Number(event.currentTarget.value)
                        });
                        scheduleSaved();
                      }}
                    />
                  </label>
                  <div class="grid grid-cols-2 gap-2">
                    <label class="grid gap-1 text-xs font-bold text-[#66717e]">
                      Offset m
                      <input
                        class="min-h-9 rounded-md border border-[#c8d1dc] bg-white px-2 text-sm text-[#17202a]"
                        inputmode="decimal"
                        min="0"
                        step="0.25"
                        type="number"
                        value={pixelsToMetres(opening.offset).toFixed(2)}
                        oninput={(event) => {
                          const value = pixelsFromMetres(
                            event.currentTarget.value
                          );
                          if (value === null) return;
                          editor.updateOpening(opening.id, { offset: value });
                          scheduleSaved();
                        }}
                      />
                    </label>
                    <label class="grid gap-1 text-xs font-bold text-[#66717e]">
                      Width m
                      <input
                        class="min-h-9 rounded-md border border-[#c8d1dc] bg-white px-2 text-sm text-[#17202a]"
                        inputmode="decimal"
                        min="0.25"
                        step="0.25"
                        type="number"
                        value={pixelsToMetres(opening.width).toFixed(2)}
                        oninput={(event) => {
                          const value = pixelsFromMetres(
                            event.currentTarget.value
                          );
                          if (value === null) return;
                          editor.updateOpening(opening.id, { width: value });
                          scheduleSaved();
                        }}
                      />
                    </label>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </section>
      {/if}
    </aside>

    <section
      class="grid min-w-0 grid-rows-[auto_minmax(0,1fr)]"
      aria-label="Floor plan editor"
    >
      <header
        class="flex min-h-16 items-center justify-between gap-4 border-b border-[#d8dee5] bg-white px-5 py-3.5"
      >
        <div class="grid gap-[3px]">
          <strong>{projectTitle}</strong>
          <span class="text-[0.88rem] text-[#6b7682]"
            >{modeTitle} · {modeSubtitle}</span
          >
        </div>
        <div class="flex items-center gap-3.5">
          {#if !isLockedBaseline}
            <button
              class="inline-flex min-h-9 items-center gap-2 rounded-md bg-[#0f766e] px-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-45"
              type="button"
              disabled={$editor.baselinePlan.rooms.length === 0}
              onclick={() => {
                editor.lockBaseline();
                scheduleSaved();
              }}
            >
              <Lock size={16} />
              Lock baseline
            </button>
          {/if}
          {#if isScenarioMode}
            <div class="relative">
              <button
                class={`inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-sm font-bold ${
                  addRoomMenuOpen
                    ? 'bg-[#17202a] text-white'
                    : 'border border-[#c8d1dc] bg-[#f8fafc] text-[#17202a]'
                }`}
                type="button"
                aria-expanded={addRoomMenuOpen}
                onclick={() => {
                  wallMenu = null;
                  editor.selectWall(null);
                  addRoomMenuOpen = !addRoomMenuOpen;
                }}
              >
                <Plus size={16} />
                Add room
              </button>
              {#if addRoomMenuOpen}
                <div
                  class="absolute right-0 top-11 z-20 grid max-h-80 w-56 overflow-auto rounded-md border border-[#b8c4d1] bg-white p-1.5 shadow-lg"
                  role="menu"
                  aria-label="Add room"
                >
                  {#each roomSetupOptions as option (option.kind)}
                    <button
                      class="min-h-9 rounded-[4px] px-3 text-left text-sm font-bold text-[#17202a] hover:bg-[#eef2f6]"
                      type="button"
                      role="menuitem"
                      onclick={() => {
                        editor.addProposedRoom(option.kind);
                        addRoomMenuOpen = false;
                        scheduleSaved();
                      }}
                    >
                      {option.label}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
          <button
            class="grid size-9 place-items-center rounded-md border border-[#c8d1dc] bg-[#f8fafc] text-[#17202a] disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            aria-label="Undo"
            disabled={$editor.past.length === 0}
            onclick={() => {
              editor.undo();
              scheduleSaved();
            }}
          >
            <Undo2 size={18} />
          </button>
          <button
            class="grid size-9 place-items-center rounded-md border border-[#c8d1dc] bg-[#f8fafc] text-[#17202a] disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            aria-label="Redo"
            disabled={$editor.future.length === 0}
            onclick={() => {
              editor.redo();
              scheduleSaved();
            }}
          >
            <Redo2 size={18} />
          </button>
          <label
            class="flex items-center gap-[7px] text-[0.88rem] text-[#344153]"
          >
            <input
              class="size-4"
              type="checkbox"
              checked={$editor.snapToGrid}
              onchange={editor.toggleSnap}
            />
            Snap {$editor.snapToGrid ? 'on' : 'off'}
          </label>
          <div
            class={`min-w-[58px] text-right text-[0.88rem] capitalize ${statusClasses[$editor.saveState]}`}
          >
            {$editor.saveState}
          </div>
          {#if !isLockedBaseline}
            <button
              class="grid size-9 place-items-center rounded-md border border-[#c8d1dc] bg-[#f8fafc] text-[#17202a]"
              type="button"
              aria-label="Reset setup"
              onclick={() => {
                editor.startNewBaseline();
                scheduleSaved();
              }}
            >
              <RotateCcw size={18} />
            </button>
          {/if}
        </div>
      </header>

      <div class="min-h-0 min-w-0 overflow-auto p-6">
        {#if wallMenu && $selectedWall && canEditWalls}
          <div
            class="fixed z-20 grid min-w-44 gap-1 rounded-md border border-[#b8c4d1] bg-white p-1.5 shadow-lg"
            style={`left: ${wallMenu.x + 10}px; top: ${wallMenu.y + 10}px;`}
            role="menu"
            aria-label="Wall actions"
          >
            <button
              class="min-h-9 rounded-[4px] px-3 text-left text-sm font-bold text-[#17202a] hover:bg-[#eef2f6]"
              type="button"
              role="menuitem"
              onclick={() => {
                editor.updateWall($selectedWall.id, {
                  structural: !$selectedWall.structural
                });
                wallMenu = null;
                scheduleSaved();
              }}
            >
              {$selectedWall.structural
                ? 'Clear structural mark'
                : 'Mark structural'}
            </button>
            {#if $selectedWall.kind !== 'exterior'}
              <button
                class="min-h-9 rounded-[4px] px-3 text-left text-sm font-bold text-[#17202a] hover:bg-[#eef2f6]"
                type="button"
                role="menuitem"
                onclick={() => {
                  editor.updateWall($selectedWall.id, {
                    removed: !$selectedWall.removed
                  });
                  wallMenu = null;
                  scheduleSaved();
                }}
              >
                Remove wall
              </button>
            {/if}
            <button
              class="min-h-9 rounded-[4px] px-3 text-left text-sm font-bold text-[#17202a] hover:bg-[#eef2f6]"
              type="button"
              role="menuitem"
              onclick={() => {
                editor.addOpening($selectedWall.id, wallMenu?.offset);
                wallMenu = null;
                scheduleSaved();
              }}
            >
              Add door/opening
            </button>
          </div>
        {/if}

        {#if isLockedBaseline && isBaselineMode}
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <svg
            class="block h-[calc(100vh-112px)] min-h-[520px] w-full min-w-[860px] border border-[#cbd5df] bg-[#eef2f6]"
            viewBox={`${canvasViewport.x} ${canvasViewport.y} ${canvasViewport.width} ${canvasViewport.height}`}
            role="application"
            tabindex="0"
            aria-label="Locked floor plan canvas. Review the existing baseline."
            onclick={handleCanvasClick}
            onkeydown={handleCanvasKeydown}
          >
            <defs>
              <pattern
                id="locked-grid"
                width={GRID_SIZE}
                height={GRID_SIZE}
                patternUnits="userSpaceOnUse"
              >
                <path
                  d={`M ${GRID_SIZE} 0 L 0 0 0 ${GRID_SIZE}`}
                  fill="none"
                  stroke="#d9e0e7"
                  stroke-width="1"
                />
              </pattern>
            </defs>

            <rect
              x={canvasViewport.x}
              y={canvasViewport.y}
              width={canvasViewport.width}
              height={canvasViewport.height}
              fill="#dde4ec"
            />
            {#if lockedBounds}
              <rect
                x={lockedBounds.x}
                y={lockedBounds.y}
                width={lockedBounds.width}
                height={lockedBounds.height}
                fill="url(#locked-grid)"
              />
              <rect
                class="pointer-events-none fill-transparent stroke-[#0f766e] stroke-[4]"
                data-testid="locked-baseline-bounds"
                x={lockedBounds.x}
                y={lockedBounds.y}
                width={lockedBounds.width}
                height={lockedBounds.height}
                rx="2"
                vector-effect="non-scaling-stroke"
              />
            {/if}

            {#each $editor.plan.rooms as room (room.id)}
              <g
                role="button"
                tabindex="0"
                aria-label={`Select ${room.name}`}
                onclick={(event) => {
                  event.stopPropagation();
                  editor.selectRoom(room.id);
                }}
                onkeydown={(event) => handleRoomKeydown(event, room.id)}
              >
                <rect
                  class={`cursor-default ${roomFillClasses[room.type]} ${
                    room.id === $editor.selectedRoomId
                      ? 'stroke-[#0f766e] stroke-[4]'
                      : 'stroke-[#1d2733] stroke-[3]'
                  }`}
                  x={room.x}
                  y={room.y}
                  width={room.width}
                  height={room.height}
                  rx="2"
                  vector-effect="non-scaling-stroke"
                />
                <text
                  class="pointer-events-none select-none fill-[#1d2733] text-base font-bold"
                  x={room.x + 14}
                  y={room.y + 28}
                >
                  {room.name}
                </text>
                {#if room.id === $editor.selectedRoomId}
                  <text
                    class="pointer-events-none select-none fill-[#344153] text-[13px] font-bold"
                    x={room.x + 14}
                    y={room.y + room.height - 16}
                  >
                    {pixelsToMetres(room.width).toFixed(2)}m x {pixelsToMetres(
                      room.height
                    ).toFixed(2)}m
                  </text>
                {/if}
              </g>
            {/each}

            {#each $editor.plan.walls as wall (wall.id)}
              {#if !wall.removed}
                {@const hitbox = wallHitbox(wall)}
                <g
                  role="button"
                  tabindex="0"
                  data-testid={wall.id}
                  aria-label={wall.kind === 'shared'
                    ? `Select shared wall between ${wall.roomIds.join(' and ')}`
                    : `Select exterior wall of ${wall.roomIds[0]}`}
                  onclick={(event) => {
                    event.stopPropagation();
                    editor.selectWall(wall.id);
                  }}
                  onkeydown={(event) => handleWallKeydown(event, wall.id)}
                >
                  <rect
                    class="cursor-default fill-black opacity-[0.01]"
                    data-testid={`${wall.id}-hitbox`}
                    x={hitbox.x}
                    y={hitbox.y}
                    width={hitbox.width}
                    height={hitbox.height}
                  />
                  <line
                    class={`pointer-events-none ${
                      wall.kind === 'exterior'
                        ? 'stroke-[#4b5563]'
                        : wall.structural
                          ? 'stroke-[#7c2d12]'
                          : 'stroke-[#111827]'
                    } ${wall.id === $editor.selectedWallId ? 'stroke-[7]' : 'stroke-[5]'}`}
                    x1={wall.x1}
                    y1={wall.y1}
                    x2={wall.x2}
                    y2={wall.y2}
                  />
                  {#each wallOpenings(wall) as opening (opening.id)}
                    {@const position = openingPosition(wall, opening)}
                    <line
                      class="pointer-events-none stroke-[#eef2f6] stroke-[10]"
                      x1={position.x1}
                      y1={position.y1}
                      x2={position.x2}
                      y2={position.y2}
                    />
                    <line
                      class="pointer-events-none stroke-[#0f766e] stroke-[2]"
                      x1={position.x1}
                      y1={position.y1}
                      x2={position.x2}
                      y2={position.y2}
                    />
                  {/each}
                </g>
              {/if}
            {/each}
          </svg>
        {:else}
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <svg
            bind:this={canvas}
            class="block h-[calc(100vh-112px)] min-h-[520px] w-full min-w-[860px] border border-[#cbd5df] bg-[#eef2f6]"
            viewBox={`${canvasViewport.x} ${canvasViewport.y} ${canvasViewport.width} ${canvasViewport.height}`}
            role="application"
            tabindex="0"
            aria-label="Floor plan canvas. Drag room blocks to arrange the existing plan."
            onpointerdown={handleCanvasPointerDown}
            onpointermove={handleCanvasPointerMove}
            onpointerup={handleCanvasPointerUp}
            onpointerleave={handleCanvasPointerUp}
            onclick={handleCanvasClick}
            onkeydown={handleCanvasKeydown}
          >
            <defs>
              <pattern
                id="grid"
                width={GRID_SIZE}
                height={GRID_SIZE}
                patternUnits="userSpaceOnUse"
              >
                <path
                  d={`M ${GRID_SIZE} 0 L 0 0 0 ${GRID_SIZE}`}
                  fill="none"
                  stroke="#d9e0e7"
                  stroke-width="1"
                />
              </pattern>
            </defs>

            {#if lockedBounds}
              <rect
                x={canvasViewport.x}
                y={canvasViewport.y}
                width={canvasViewport.width}
                height={canvasViewport.height}
                fill="#dde4ec"
              />
              <rect
                x={lockedBounds.x}
                y={lockedBounds.y}
                width={lockedBounds.width}
                height={lockedBounds.height}
                fill="url(#grid)"
              />
              <rect
                class="pointer-events-none fill-transparent stroke-[#0f766e] stroke-[4] [stroke-dasharray:10_8]"
                data-testid="scenario-bounds"
                x={lockedBounds.x}
                y={lockedBounds.y}
                width={lockedBounds.width}
                height={lockedBounds.height}
                rx="2"
                vector-effect="non-scaling-stroke"
              />
            {:else}
              <rect
                x={canvasViewport.x}
                y={canvasViewport.y}
                width={canvasViewport.width}
                height={canvasViewport.height}
                fill="url(#grid)"
              />
            {/if}

            {#if isScenarioMode && $editor.showReferenceBackground}
              {#each $editor.baselinePlan.rooms as room (room.id)}
                <rect
                  class={`${roomFillClasses[room.type]} pointer-events-none opacity-25 stroke-[#5f6c7b] stroke-[1]`}
                  data-testid={`reference-${room.id}`}
                  x={room.x}
                  y={room.y}
                  width={room.width}
                  height={room.height}
                  rx="2"
                  vector-effect="non-scaling-stroke"
                />
              {/each}
            {/if}

            {#if !isScenarioMode}
              {#each $editor.plan.rooms as room (room.id)}
                <g
                  role="button"
                  tabindex="0"
                  aria-label={`Select ${room.name}`}
                  onpointerdown={(event) => handleRoomPointerDown(event, room)}
                  onclick={handleRoomClick}
                  onkeydown={(event) => handleRoomKeydown(event, room.id)}
                >
                  <rect
                    class="cursor-move {roomFillClasses[room.type]} {room.id ===
                    $editor.selectedRoomId
                      ? 'stroke-[#0f766e] stroke-[4]'
                      : 'stroke-[#1d2733] stroke-[3]'}"
                    x={room.x}
                    y={room.y}
                    width={room.width}
                    height={room.height}
                    rx="2"
                    vector-effect="non-scaling-stroke"
                  />
                  <text
                    class="pointer-events-none select-none fill-[#1d2733] text-base font-bold"
                    x={room.x + 14}
                    y={room.y + 28}
                  >
                    {room.name}
                  </text>
                  {#if room.id === $editor.selectedRoomId}
                    <text
                      class="pointer-events-none select-none fill-[#344153] text-[13px] font-bold"
                      x={room.x + 14}
                      y={room.y + room.height - 16}
                    >
                      {pixelsToMetres(room.width).toFixed(2)}m x {pixelsToMetres(
                        room.height
                      ).toFixed(2)}m
                    </text>
                  {/if}
                </g>
              {/each}
            {/if}

            {#if !isScenarioMode}
              {#each $editor.plan.walls as wall (wall.id)}
                {#if !wall.removed}
                  {@const hitbox = wallHitbox(wall)}
                  <g
                    role="button"
                    tabindex="0"
                    data-testid={wall.id}
                    aria-label={wall.kind === 'shared'
                      ? `Select shared wall between ${wall.roomIds.join(' and ')}`
                      : `Select exterior wall of ${wall.roomIds[0]}`}
                    onpointerdown={(event) =>
                      handleWallPointerDown(event, wall.id)}
                    onclick={handleWallClick}
                    onkeydown={(event) => handleWallKeydown(event, wall.id)}
                  >
                    <rect
                      class="cursor-pointer fill-black opacity-[0.01]"
                      data-testid={`${wall.id}-hitbox`}
                      x={hitbox.x}
                      y={hitbox.y}
                      width={hitbox.width}
                      height={hitbox.height}
                    />
                    <line
                      class={`pointer-events-none ${
                        wall.kind === 'exterior'
                          ? 'stroke-[#4b5563]'
                          : wall.structural
                            ? 'stroke-[#7c2d12]'
                            : 'stroke-[#111827]'
                      } ${wall.id === $editor.selectedWallId ? 'stroke-[7]' : 'stroke-[5]'}`}
                      x1={wall.x1}
                      y1={wall.y1}
                      x2={wall.x2}
                      y2={wall.y2}
                    />
                    {#each wallOpenings(wall) as opening (opening.id)}
                      {@const position = openingPosition(wall, opening)}
                      <line
                        class="pointer-events-none stroke-[#eef2f6] stroke-[10]"
                        x1={position.x1}
                        y1={position.y1}
                        x2={position.x2}
                        y2={position.y2}
                      />
                      <line
                        class="pointer-events-none stroke-[#0f766e] stroke-[2]"
                        x1={position.x1}
                        y1={position.y1}
                        x2={position.x2}
                        y2={position.y2}
                      />
                    {/each}
                  </g>
                {/if}
              {/each}
            {/if}

            {#if !isScenarioMode && $selectedRoom}
              <g aria-label={`Resize ${$selectedRoom.name}`}>
                {#each resizeHandles($selectedRoom) as item (item.handle)}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <rect
                    class={`fill-white stroke-[#0f766e] stroke-[2] ${handleCursors[item.handle]}`}
                    x={item.x - 5}
                    y={item.y - 5}
                    width="10"
                    height="10"
                    rx="2"
                    vector-effect="non-scaling-stroke"
                    onpointerdown={(event) =>
                      handleResizePointerDown(
                        event,
                        $selectedRoom.id,
                        item.handle
                      )}
                  />
                {/each}
              </g>
            {/if}

            {#if isScenarioMode}
              {#each $editor.plan.proposedRooms as room (room.id)}
                <g
                  role="button"
                  tabindex="0"
                  data-testid={room.id}
                  aria-label={`Select proposed ${room.name}`}
                  onpointerdown={(event) =>
                    handleProposedRoomPointerDown(event, room)}
                  onclick={handleRoomClick}
                  onkeydown={(event) =>
                    handleProposedRoomKeydown(event, room.id)}
                >
                  <rect
                    class={`cursor-move ${roomFillClasses[room.type]} opacity-70 ${
                      room.id === $editor.selectedProposedRoomId
                        ? 'stroke-[#0f766e] stroke-[4]'
                        : 'stroke-[#0f766e] stroke-[3] [stroke-dasharray:9_7]'
                    }`}
                    x={room.x}
                    y={room.y}
                    width={room.width}
                    height={room.height}
                    rx="2"
                    vector-effect="non-scaling-stroke"
                  />
                  <text
                    class="pointer-events-none select-none fill-[#0f3f3a] text-base font-bold"
                    x={room.x + 14}
                    y={room.y + 28}
                  >
                    {room.name}
                  </text>
                  <text
                    class="pointer-events-none select-none fill-[#0f766e] text-[12px] font-bold uppercase"
                    x={room.x + 14}
                    y={room.y + 46}
                  >
                    Proposed
                  </text>
                  {#if room.id === $editor.selectedProposedRoomId}
                    <text
                      class="pointer-events-none select-none fill-[#344153] text-[12px] font-bold"
                      x={room.x + room.width / 2}
                      y={room.y + room.height - 14}
                      text-anchor="middle"
                    >
                      {pixelsToMetres(room.width).toFixed(2)}m width
                    </text>
                    <text
                      class="pointer-events-none select-none fill-[#344153] text-[13px] font-bold"
                      x={room.x + room.width - 14}
                      y={room.y + room.height / 2}
                      text-anchor="middle"
                      transform={`rotate(-90 ${room.x + room.width - 14} ${room.y + room.height / 2})`}
                    >
                      {pixelsToMetres(room.height).toFixed(2)}m depth
                    </text>
                    {#each resizeHandles(room) as item (item.handle)}
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <rect
                        class={`fill-white stroke-[#0f766e] stroke-[2] ${handleCursors[item.handle]}`}
                        x={item.x - 5}
                        y={item.y - 5}
                        width="10"
                        height="10"
                        rx="2"
                        vector-effect="non-scaling-stroke"
                        onpointerdown={(event) =>
                          handleResizePointerDown(
                            event,
                            room.id,
                            item.handle,
                            'proposed-room'
                          )}
                      />
                    {/each}
                  {/if}
                </g>
              {/each}
            {/if}
          </svg>
        {/if}
      </div>
    </section>
  </main>
{/if}
