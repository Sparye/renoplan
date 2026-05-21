<script lang="ts">
  const sampleRooms = [
    { id: 'bedroom-1', name: 'Bedroom 1', type: 'bedroom', x: 320, y: 90, width: 180, height: 150 },
    { id: 'kitchen', name: 'Kitchen', type: 'kitchen', x: 500, y: 90, width: 170, height: 150 },
    { id: 'living', name: 'Living Room', type: 'living', x: 320, y: 240, width: 350, height: 190 },
    { id: 'toilet', name: 'Toilet', type: 'wet', x: 670, y: 90, width: 95, height: 105 }
  ];

  const trayRooms = ['Bedroom 2', 'Bedroom 3', 'Laundry'];
</script>

<svelte:head>
  <title>Renovation Floor Plan</title>
  <meta
    name="description"
    content="Conceptual renovation planner for creating and comparing room-based floor plans."
  />
</svelte:head>

<main class="app-shell">
  <aside class="sidebar">
    <div>
      <p class="eyebrow">Existing plan setup</p>
      <h1>Assemble your current floor plan</h1>
    </div>

    <section class="panel">
      <h2>Room tray</h2>
      <div class="tray-list">
        {#each trayRooms as room}
          <button class="tray-item" type="button">{room}</button>
        {/each}
      </div>
    </section>

    <section class="panel">
      <h2>Checklist</h2>
      <ol class="setup-steps">
        <li class="active">Place generated room blocks</li>
        <li>Resize and snap shared walls</li>
        <li>Review derived footprint</li>
        <li>Lock baseline</li>
      </ol>
    </section>
  </aside>

  <section class="workspace" aria-label="Floor plan editor">
    <header class="topbar">
      <div>
        <strong>My Renovation Project</strong>
        <span>Existing v1</span>
      </div>
      <div class="status">Saved</div>
    </header>

    <div class="canvas-wrap">
      <svg class="floor-canvas" viewBox="0 0 960 620" role="img" aria-label="Sample floor plan canvas">
        <defs>
          <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#d9e0e7" stroke-width="1" />
          </pattern>
        </defs>

        <rect width="960" height="620" fill="url(#grid)" />

        {#each sampleRooms as room}
          <g class={`room room-${room.type}`}>
            <rect
              x={room.x}
              y={room.y}
              width={room.width}
              height={room.height}
              rx="2"
              vector-effect="non-scaling-stroke"
            />
            <text x={room.x + 14} y={room.y + 28}>{room.name}</text>
          </g>
        {/each}

        <line class="shared-wall" x1="500" y1="90" x2="500" y2="240" />
        <line class="removed-wall" x1="390" y1="240" x2="520" y2="240" />
        <g class="door">
          <line x1="670" y1="145" x2="670" y2="190" />
          <path d="M 670 190 A 45 45 0 0 1 715 145" />
        </g>
      </svg>
    </div>
  </section>
</main>
