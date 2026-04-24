/**
 * Engine Map — Interactive SVG animations and particle system.
 */
(function () {
  'use strict';

  const svg = document.getElementById('engine-svg');
  const particlesGroup = document.getElementById('particles');

  // ===== PARTICLE SYSTEM =====
  // Animated dots that travel along data-flow paths
  const PARTICLE_COUNT = 24;
  const PARTICLE_COLORS = ['#00d4ff', '#7b61ff', '#ff6b6b', '#ffd93d', '#4ecdc4', '#48bb78'];

  function createParticles() {
    const flowPaths = document.querySelectorAll('.flow-path');
    if (!flowPaths.length) return;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const pathEl = flowPaths[i % flowPaths.length];
      const pathLen = pathEl.getTotalLength();
      if (pathLen === 0) continue;

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', '2.5');
      circle.setAttribute('fill', PARTICLE_COLORS[i % PARTICLE_COLORS.length]);
      circle.setAttribute('opacity', '0');
      particlesGroup.appendChild(circle);

      animateParticle(circle, pathEl, pathLen, i * 400 + Math.random() * 1000);
    }
  }

  function animateParticle(circle, pathEl, pathLen, delay) {
    const duration = 3000 + Math.random() * 2000;
    let start = null;
    let paused = true;

    setTimeout(() => { paused = false; }, delay);

    function step(ts) {
      if (paused) { requestAnimationFrame(step); return; }
      if (!start) start = ts;

      const elapsed = (ts - start) % duration;
      const t = elapsed / duration;
      const pt = pathEl.getPointAtLength(t * pathLen);

      circle.setAttribute('cx', pt.x);
      circle.setAttribute('cy', pt.y);

      // Fade in/out at endpoints
      let opacity = 1;
      if (t < 0.1) opacity = t / 0.1;
      else if (t > 0.9) opacity = (1 - t) / 0.1;
      circle.setAttribute('opacity', opacity * 0.8);

      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // ===== NODE HOVER EFFECTS =====
  function setupNodeHover() {
    const nodes = document.querySelectorAll('.node');
    nodes.forEach(node => {
      node.addEventListener('mouseenter', () => {
        // Dim other nodes slightly
        nodes.forEach(n => {
          if (n !== node) n.style.opacity = '0.4';
        });
        // Brighten associated flows
        highlightFlows(node.dataset.component, true);
      });
      node.addEventListener('mouseleave', () => {
        nodes.forEach(n => n.style.opacity = '1');
        highlightFlows(null, false);
      });
    });
  }

  // Map component → which flow classes to highlight
  const FLOW_MAP = {
    'query-engine': ['.flow-cyan', '.flow-purple', '.flow-teal', '.flow-gold'],
    'system-prompt': ['.flow-cyan', '.flow-gold'],
    'tool-runtime': ['.flow-cyan', '.flow-red', '.flow-green'],
    'agent-orchestration': ['.flow-purple'],
    'security': ['.flow-red'],
    'state-persistence': ['.flow-teal'],
    'token-economics': ['.flow-gold'],
    'configuration': ['.flow-gold'],
    'extension-ecosystem': ['.flow-green'],
  };

  function highlightFlows(componentId, highlight) {
    const allFlows = document.querySelectorAll('.flow-path');
    if (!highlight) {
      allFlows.forEach(f => { f.style.opacity = ''; f.style.strokeWidth = ''; });
      return;
    }
    const selectors = FLOW_MAP[componentId] || [];
    allFlows.forEach(f => {
      const matches = selectors.some(sel => f.matches(sel));
      f.style.opacity = matches ? '1' : '0.1';
      f.style.strokeWidth = matches ? '3' : '';
    });
  }

  // ===== SVG PAN/ZOOM (simple scroll-to-zoom) =====
  let scale = 1;
  let translateX = 0, translateY = 0;
  const engineContainer = document.getElementById('engine-container');

  function setupZoom() {
    if (!engineContainer) return;
    engineContainer.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return; // only zoom with Ctrl/Cmd + scroll
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      scale = Math.min(3, Math.max(0.5, scale * delta));
      applyTransform();
    }, { passive: false });
  }

  function applyTransform() {
    svg.style.transform = `scale(${scale}) translate(${translateX}px, ${translateY}px)`;
  }

  // ===== INIT =====
  function init() {
    createParticles();
    setupNodeHover();
    setupZoom();
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Export for app.js
  window.EngineMap = { highlightFlows };
})();
