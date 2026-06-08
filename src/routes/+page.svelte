<script lang="ts">
  import {
    ArrowLeft,
    Check,
    Minus,
    Plus,
    Redo2,
    RotateCcw,
    Undo2
  } from '@lucide/svelte';
  import { onDestroy } from 'svelte';
  import {
    editor,
    GRID_SIZE,
    metresToPixels,
    pixelsToMetres,
    roomSetupOptions,
    selectedRoom,
    selectedWall
  } from '$lib/editor/editorStore';
  import type { ResizeHandle } from '$lib/editor/editorStore';
  import type { Opening, Room, SetupRoomKind, Wall } from '$lib/domain/types';

  const CANVAS_WIDTH = 960;
  const CANVAS_HEIGHT = 620;

  let canvas: SVGSVGElement;
  let interaction:
    | {
        mode: 'move';
        roomId: string;
        offsetX: number;
        offsetY: number;
        historyCaptured: boolean;
      }
    | {
        mode: 'resize';
        roomId: string;
        handle: ResizeHandle;
        historyCaptured: boolean;
      }
    | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  let counts = Object.fromEntries(
    roomSetupOptions.map((option) => [option.kind, 0])
  ) as Record<SetupRoomKind, number>;

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

  function handleRoomPointerDown(event: PointerEvent, room: Room) {
    event.stopPropagation();
    const point = getCanvasPoint(event);
    interaction = {
      mode: 'move',
      roomId: room.id,
      offsetX: point.x - room.x,
      offsetY: point.y - room.y,
      historyCaptured: false
    };

    editor.selectRoom(room.id);
    canvas.setPointerCapture(event.pointerId);
  }

  function handleResizePointerDown(
    event: PointerEvent,
    roomId: string,
    handle: ResizeHandle
  ) {
    event.stopPropagation();
    interaction = {
      mode: 'resize',
      roomId,
      handle,
      historyCaptured: false
    };
    editor.selectRoom(roomId);
    canvas.setPointerCapture(event.pointerId);
  }

  function handleWallPointerDown(event: PointerEvent, wallId: string) {
    event.stopPropagation();
    editor.selectWall(wallId);
  }

  function handleCanvasPointerMove(event: PointerEvent) {
    if (!interaction) return;

    const point = getCanvasPoint(event);

    if (interaction.mode === 'move') {
      editor.moveRoom(
        interaction.roomId,
        point.x - interaction.offsetX,
        point.y - interaction.offsetY,
        {
          history: !interaction.historyCaptured
        }
      );
    } else {
      editor.resizeRoom(
        interaction.roomId,
        interaction.handle,
        point.x,
        point.y,
        {
          history: !interaction.historyCaptured
        }
      );
    }

    interaction.historyCaptured = true;
    scheduleSaved();
  }

  function handleCanvasPointerUp(event: PointerEvent) {
    if (interaction && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }

    interaction = null;
  }

  function handleCanvasKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      editor.selectRoom(null);
    }
  }

  function handleRoomKeydown(event: KeyboardEvent, roomId: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      editor.selectRoom(roomId);
    }
  }

  function handleWallKeydown(event: KeyboardEvent, wallId: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      editor.selectWall(wallId);
    }
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

  function resizeHandles(
    room: Room
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

  onDestroy(() => clearTimeout(saveTimer));
</script>

<svelte:head>
  <title>Renoplan</title>
  <meta
    name="description"
    content="Conceptual renovation planner for creating and comparing room-based floor plans."
  />
</svelte:head>

{#if $editor.setupStep !== 'editor'}
  <main class="min-h-screen bg-[#f4f6f8] text-[#17202a]">
    <section
      class="mx-auto grid min-h-screen max-w-5xl content-start gap-8 px-6 py-10"
    >
      <header class="grid gap-3">
        <p
          class="m-0 text-[0.78rem] font-bold tracking-normal text-[#6b7682] uppercase"
        >
          Existing plan setup
        </p>
        <h1
          class="m-0 max-w-3xl text-[2rem] leading-[1.1] font-bold tracking-normal"
        >
          Start with the rooms you already have.
        </h1>
      </header>

      {#if $editor.setupStep === 'counts'}
        <section class="grid gap-5">
          <div class="flex items-end justify-between gap-4">
            <div class="grid gap-1">
              <h2 class="m-0 text-[1.1rem] font-bold tracking-normal">
                Count each room
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
                    disabled={counts[option.kind] === 0}
                    on:click={() => countRoom(option.kind, -1)}
                  >
                    <Minus size={17} />
                  </button>
                  <button
                    class="grid size-9 place-items-center rounded-md border border-[#c8d1dc] bg-[#f8fafc] text-[#17202a]"
                    type="button"
                    aria-label={`Add ${option.label}`}
                    on:click={() => countRoom(option.kind, 1)}
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
              on:click={submitCounts}
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
                    on:input={(event) =>
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
                    step="0.25"
                    type="number"
                    value={pixelsToMetres(room.width).toFixed(2)}
                    on:input={(event) =>
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
                    step="0.25"
                    type="number"
                    value={pixelsToMetres(room.height).toFixed(2)}
                    on:input={(event) =>
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
                  on:click={() => useSuggestedSize(room.id, room.kind)}
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
              on:click={editor.returnToCounts}
            >
              <ArrowLeft size={18} />
              Counts
            </button>
            <button
              class="inline-flex min-h-11 items-center gap-2 rounded-md bg-[#0f766e] px-4 text-sm font-bold text-white"
              type="button"
              on:click={() => {
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
          Existing plan editor
        </p>
        <h1 class="m-0 text-[1.35rem] leading-[1.2] font-bold tracking-normal">
          Arrange your measured rooms
        </h1>
      </div>

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
          on:click={editor.returnToSetup}
        >
          <ArrowLeft size={17} />
          Edit setup
        </button>
      </section>

      <section class="grid gap-3">
        <h2 class="m-0 text-[0.92rem] font-bold tracking-normal">Next</h2>
        <ol class="m-0 grid gap-2.5 pl-5 text-[#66717e]">
          <li class="font-bold text-[#17202a]">Drag rooms into position</li>
          <li>Resize rooms if measurements change</li>
          <li>Join room edges to create shared walls</li>
          <li>Lock baseline when the footprint looks right</li>
        </ol>
      </section>

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

      {#if $selectedWall}
        <section class="grid gap-3" aria-live="polite">
          <h2 class="m-0 text-[0.92rem] font-bold tracking-normal">
            Selected wall
          </h2>
          <dl class="m-0 grid gap-[9px]">
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
              <dd class="m-0 text-sm font-bold text-[#17202a]">
                {wallOpenings($selectedWall).length}
              </dd>
            </div>
          </dl>
          <div class="grid gap-2">
            <button
              class="min-h-10 rounded-md border border-[#c8d1dc] bg-[#f8fafc] px-3 text-left text-sm font-bold text-[#17202a]"
              type="button"
              on:click={() =>
                editor.updateWall($selectedWall.id, {
                  structural: !$selectedWall.structural
                })}
            >
              {$selectedWall.structural
                ? 'Clear structural mark'
                : 'Mark structural'}
            </button>
            <button
              class="min-h-10 rounded-md border border-[#c8d1dc] bg-[#f8fafc] px-3 text-left text-sm font-bold text-[#17202a]"
              type="button"
              on:click={() =>
                editor.updateWall($selectedWall.id, {
                  removed: !$selectedWall.removed
                })}
            >
              {$selectedWall.removed ? 'Restore wall' : 'Remove wall'}
            </button>
            <button
              class="min-h-10 rounded-md border border-[#c8d1dc] bg-[#f8fafc] px-3 text-left text-sm font-bold text-[#17202a]"
              type="button"
              on:click={() => editor.addOpening($selectedWall.id)}
            >
              Add door/opening
            </button>
          </div>
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
          <strong>My Renoplan Project</strong>
          <span class="text-[0.88rem] text-[#6b7682]">Existing v1 draft</span>
        </div>
        <div class="flex items-center gap-3.5">
          <button
            class="grid size-9 place-items-center rounded-md border border-[#c8d1dc] bg-[#f8fafc] text-[#17202a] disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            aria-label="Undo"
            disabled={$editor.past.length === 0}
            on:click={() => {
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
            on:click={() => {
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
              on:change={editor.toggleSnap}
            />
            Snap {$editor.snapToGrid ? 'on' : 'off'}
          </label>
          <div
            class={`min-w-[58px] text-right text-[0.88rem] capitalize ${statusClasses[$editor.saveState]}`}
          >
            {$editor.saveState}
          </div>
          <button
            class="grid size-9 place-items-center rounded-md border border-[#c8d1dc] bg-[#f8fafc] text-[#17202a]"
            type="button"
            aria-label="Reset setup"
            on:click={() => {
              editor.resetLocalPlan();
              scheduleSaved();
            }}
          >
            <RotateCcw size={18} />
          </button>
        </div>
      </header>

      <div class="min-h-0 min-w-0 overflow-auto p-6">
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <svg
          bind:this={canvas}
          class="block h-[calc(100vh-112px)] min-h-[520px] w-full min-w-[860px] border border-[#cbd5df] bg-[#eef2f6]"
          viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
          role="application"
          tabindex="0"
          aria-label="Floor plan canvas. Drag room blocks to arrange the existing plan."
          on:pointermove={handleCanvasPointerMove}
          on:pointerup={handleCanvasPointerUp}
          on:pointerleave={handleCanvasPointerUp}
          on:click={() => !interaction && editor.selectRoom(null)}
          on:keydown={handleCanvasKeydown}
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

          <rect width={CANVAS_WIDTH} height={CANVAS_HEIGHT} fill="url(#grid)" />

          {#each $editor.plan.rooms as room (room.id)}
            <g
              role="button"
              tabindex="0"
              aria-label={`Select ${room.name}`}
              on:pointerdown={(event) => handleRoomPointerDown(event, room)}
              on:click={(event) => event.stopPropagation()}
              on:keydown={(event) => handleRoomKeydown(event, room.id)}
            >
              <rect
                class={`cursor-move ${roomFillClasses[room.type]} ${
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
              {#if room.id === $editor.selectedRoomId}
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
                    on:pointerdown={(event) =>
                      handleResizePointerDown(event, room.id, item.handle)}
                  />
                {/each}
              {/if}
            </g>
          {/each}

          {#each $editor.plan.walls as wall (wall.id)}
            <g
              role="button"
              tabindex="0"
              aria-label={`Select shared wall between ${wall.roomIds.join(' and ')}`}
              on:pointerdown={(event) => handleWallPointerDown(event, wall.id)}
              on:click={(event) => event.stopPropagation()}
              on:keydown={(event) => handleWallKeydown(event, wall.id)}
            >
              <line
                class="cursor-pointer stroke-transparent stroke-[18]"
                x1={wall.x1}
                y1={wall.y1}
                x2={wall.x2}
                y2={wall.y2}
              />
              <line
                class={wall.removed
                  ? `pointer-events-none stroke-white stroke-[8] [stroke-dasharray:12_8] ${
                      wall.id === $editor.selectedWallId
                        ? 'drop-shadow-[0_0_2px_#0f766e]'
                        : ''
                    }`
                  : `pointer-events-none ${
                      wall.structural ? 'stroke-[#7c2d12]' : 'stroke-[#111827]'
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
          {/each}
        </svg>
      </div>
    </section>
  </main>
{/if}
