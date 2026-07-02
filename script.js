(() => {
  const freqSlider = document.getElementById('freqSlider');
  const impulseSlider = document.getElementById('impulseSlider');
  const freqValue = document.getElementById('freqValue');
  const impulseValue = document.getElementById('impulseValue');
  const zoneCount = document.getElementById('zoneCount');
  const sessionClock = document.getElementById('sessionClock');
  const nodes = Array.from(document.querySelectorAll('.body-diagram .node'));

  const zoneOrder = ['neck', 'chest', 'back', 'arms', 'abs', 'glutes', 'quads', 'calves'];

  function activeZoneCountFor(impulse) {
    // Higher impulse recruits more zones simultaneously (min 2, max 8)
    return Math.max(2, Math.round((impulse / 100) * zoneOrder.length));
  }

  function renderZones() {
    const impulse = Number(impulseSlider.value);
    const count = activeZoneCountFor(impulse);
    const activeZones = new Set(zoneOrder.slice(0, count));

    nodes.forEach((node) => {
      const zone = node.dataset.zone;
      node.classList.toggle('is-active', activeZones.has(zone));
    });

    zoneCount.textContent = String(count);
  }

  function renderReadouts() {
    freqValue.textContent = freqSlider.value;
    impulseValue.textContent = impulseSlider.value;
  }

  freqSlider.addEventListener('input', renderReadouts);
  impulseSlider.addEventListener('input', () => {
    renderReadouts();
    renderZones();
  });

  renderReadouts();
  renderZones();

  // Rotate which zones are highlighted every few seconds to suggest a live session,
  // respecting reduced-motion preference.
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!prefersReducedMotion) {
    let rotation = 0;
    setInterval(() => {
      rotation = (rotation + 1) % zoneOrder.length;
      const impulse = Number(impulseSlider.value);
      const count = activeZoneCountFor(impulse);
      const activeZones = new Set();
      for (let i = 0; i < count; i++) {
        activeZones.add(zoneOrder[(rotation + i) % zoneOrder.length]);
      }
      nodes.forEach((node) => {
        node.classList.toggle('is-active', activeZones.has(node.dataset.zone));
      });
    }, 2600);
  }

  // Session countdown demo, loops from 20:00 to 00:00.
  let remainingSeconds = 20 * 60;
  function renderClock() {
    const m = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
    const s = String(remainingSeconds % 60).padStart(2, '0');
    sessionClock.textContent = `${m}:${s}`;
  }
  if (!prefersReducedMotion) {
    setInterval(() => {
      remainingSeconds = remainingSeconds <= 0 ? 20 * 60 : remainingSeconds - 1;
      renderClock();
    }, 1000);
  }

  const form = document.getElementById('contactForm');
  const confirm = document.getElementById('formConfirm');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    confirm.textContent = 'Danke — wir melden uns innerhalb eines Werktags bei dir.';
    form.reset();
  });
})();
