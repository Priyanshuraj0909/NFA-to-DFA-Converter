/**
 * graph.js — Dependency-free SVG renderer for state diagrams.
 *
 * Features: BFS-layered automatic layout, draggable states, self-loops,
 * curved edges for opposite directions / edges that would cross a node,
 * merged labels for parallel edges, start arrow, double circle for final
 * states, highlighting of active states/edges, and SVG export.
 */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const R = 24; // node radius
  const COL = 180; // horizontal distance between BFS layers
  const ROW = 120; // vertical distance inside a layer

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  /** Assign each state to a column by BFS distance from the start state. */
  function computeLayout(states, start, edges) {
    const adj = {};
    states.forEach((s) => (adj[s] = []));
    edges.forEach((e) => adj[e.from] && adj[e.from].push(e.to));
    const layer = {};
    const order = [];
    if (start !== undefined && adj[start]) {
      layer[start] = 0;
      const q = [start];
      while (q.length) {
        const s = q.shift();
        order.push(s);
        for (const t of adj[s]) {
          if (layer[t] === undefined && adj[t]) {
            layer[t] = layer[s] + 1;
            q.push(t);
          }
        }
      }
    }
    const maxLayer = order.length ? Math.max(...order.map((s) => layer[s])) : -1;
    for (const s of states) {
      if (layer[s] === undefined) {
        layer[s] = maxLayer + 1; // unreachable states go in an extra column
        order.push(s);
      }
    }
    const columns = {};
    for (const s of order) (columns[layer[s]] = columns[layer[s]] || []).push(s);
    const pos = {};
    for (const l of Object.keys(columns)) {
      const col = columns[l];
      col.forEach((s, i) => {
        // stagger nodes that share a column so edges between them are not vertical
        const stagger = col.length > 1 ? (i % 2 ? 30 : -30) : 0;
        pos[s] = { x: 60 + Number(l) * COL + stagger, y: 160 + (i - (col.length - 1) / 2) * ROW };
      });
    }
    return pos;
  }

  /** Shortest distance from point p to segment ab. */
  function segDist(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  class GraphView {
    constructor(svg) {
      this.svg = svg;
      this.pos = {};
      this.layoutKey = null;
      this.data = null;
      this.drag = null;
      svg.classList.add('graph');
      svg.addEventListener('pointermove', (e) => this._onMove(e));
      svg.addEventListener('pointerup', () => this._endDrag());
      svg.addEventListener('pointerleave', () => this._endDrag());
    }

    /**
     * data = {
     *   states, start, finals, edges:[{from,to,symbol}],     // what to draw
     *   layout: {states, start, edges}  (optional)           // full graph used for stable positions
     *   layoutKey: string                                    // reset positions when it changes
     *   subtitles: {state: text}, highlight: Set, secondary: Set, fresh: Set, dead: Set,
     *   highlightEdges: Set of "from|to", emptyText
     * }
     */
    render(data) {
      this.data = data;
      const layoutSrc = data.layout || data;
      if (data.layoutKey !== this.layoutKey || layoutSrc.states.some((s) => !this.pos[s])) {
        const fresh = computeLayout(layoutSrc.states, layoutSrc.start, layoutSrc.edges);
        if (data.layoutKey !== this.layoutKey) this.pos = fresh;
        else for (const s of layoutSrc.states) if (!this.pos[s]) this.pos[s] = fresh[s];
        this.layoutKey = data.layoutKey;
      }
      this._draw();
      if (!this.drag) this._fit();
    }

    _draw() {
      const svg = this.svg;
      const d = this.data;
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      const defs = el('defs', {}, svg);
      for (const [id, cls] of [['arrow', 'arrow'], ['arrow-hl', 'arrow hl']]) {
        const m = el('marker', { id: svg.id + '-' + id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
        el('path', { d: 'M0,0 L10,5 L0,10 z', class: cls }, m);
      }
      if (!d.states.length) {
        el('text', { x: 200, y: 120, class: 'empty-text', 'text-anchor': 'middle' }, svg).textContent = d.emptyText || 'Nothing to show yet';
        return;
      }

      const visible = new Set(d.states);
      const hlEdges = d.highlightEdges || new Set();
      // Merge parallel edges into one arrow with a combined label.
      const groups = new Map();
      for (const e of d.edges) {
        if (!visible.has(e.from) || !visible.has(e.to)) continue;
        const k = e.from + '|' + e.to;
        if (!groups.has(k)) groups.set(k, { from: e.from, to: e.to, labels: [] });
        groups.get(k).labels.push(e.symbol);
      }

      const edgeLayer = el('g', {}, svg);
      const labelLayer = el('g', {}, svg);
      for (const [k, g] of groups) {
        const hl = hlEdges.has(k);
        const cls = 'edge' + (hl ? ' hl' : '');
        const marker = `url(#${svg.id}-${hl ? 'arrow-hl' : 'arrow'})`;
        const a = this.pos[g.from];
        const b = this.pos[g.to];
        const label = g.labels.join(', ');
        let lx;
        let ly;
        if (g.from === g.to) {
          const x1 = a.x - R * Math.sin(Math.PI / 7);
          const x2 = a.x + R * Math.sin(Math.PI / 7);
          const y = a.y - R * Math.cos(Math.PI / 7);
          el('path', { d: `M${x1},${y} C${a.x - 40},${a.y - 85} ${a.x + 40},${a.y - 85} ${x2},${y}`, class: cls, 'marker-end': marker }, edgeLayer);
          lx = a.x;
          ly = a.y - 72;
        } else {
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 1;
          const nx = -dy / dist;
          const ny = dx / dist;
          let bend = 0;
          if (groups.has(g.to + '|' + g.from)) bend = 26;
          else {
            const blocked = d.states.some((s) => s !== g.from && s !== g.to && segDist(this.pos[s], a, b) < R + 10);
            if (blocked) bend = 50 + Math.min(dist / 6, 60);
          }
          const cx = (a.x + b.x) / 2 + nx * bend * 2;
          const cy = (a.y + b.y) / 2 + ny * bend * 2;
          const toward = (p, q, r) => {
            const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
            return { x: p.x + ((q.x - p.x) / l) * r, y: p.y + ((q.y - p.y) / l) * r };
          };
          const c = { x: cx, y: cy };
          const s = toward(a, bend ? c : b, R);
          const t = toward(b, bend ? c : a, R + 1);
          el('path', { d: `M${s.x},${s.y} Q${cx},${cy} ${t.x},${t.y}`, class: cls, 'marker-end': marker }, edgeLayer);
          // point on the quadratic curve at t = 0.5, nudged off the line
          lx = 0.25 * s.x + 0.5 * cx + 0.25 * t.x + nx * 11;
          ly = 0.25 * s.y + 0.5 * cy + 0.25 * t.y + ny * 11;
        }
        el('text', { x: lx, y: ly + 4, class: 'edge-label' + (hl ? ' hl' : ''), 'text-anchor': 'middle' }, labelLayer).textContent = label;
      }

      // Start arrow
      if (visible.has(d.start)) {
        const p = this.pos[d.start];
        el('line', { x1: p.x - R - 38, y1: p.y, x2: p.x - R - 2, y2: p.y, class: 'edge start', 'marker-end': `url(#${svg.id}-arrow)` }, edgeLayer);
        el('text', { x: p.x - R - 40, y: p.y - 6, class: 'start-label' }, labelLayer).textContent = 'start';
      }

      const finals = new Set(d.finals);
      const nodeLayer = el('g', {}, svg);
      for (const s of d.states) {
        const p = this.pos[s];
        let cls = 'node';
        if (finals.has(s)) cls += ' final';
        if (d.highlight && d.highlight.has(s)) cls += ' hl';
        else if (d.secondary && d.secondary.has(s)) cls += ' secondary';
        if (d.fresh && d.fresh.has(s)) cls += ' fresh';
        if (d.dead && d.dead.has(s)) cls += ' dead';
        const g = el('g', { class: cls, transform: `translate(${p.x},${p.y})` }, nodeLayer);
        el('circle', { r: R, class: 'outer' }, g);
        if (finals.has(s)) el('circle', { r: R - 4.5, class: 'inner' }, g);
        const name = el('text', { 'text-anchor': 'middle', y: 5, class: 'node-label' }, g);
        name.textContent = s.length > 6 ? s.slice(0, 5) + '…' : s;
        const title = el('title', {}, g);
        title.textContent = s + (d.subtitles && d.subtitles[s] ? ' = ' + d.subtitles[s] : '');
        if (d.subtitles && d.subtitles[s] !== undefined) {
          let sub = d.subtitles[s];
          if (sub.length > 26) sub = sub.slice(0, 25) + '…';
          el('text', { 'text-anchor': 'middle', y: R + 16, class: 'node-sub' }, g).textContent = sub;
        }
        g.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          this.drag = { id: s };
          this.svg.setPointerCapture && this.svg.setPointerCapture(e.pointerId);
          this.svg.classList.add('dragging');
        });
      }
    }

    _toSvg(e) {
      const pt = this.svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      return pt.matrixTransform(this.svg.getScreenCTM().inverse());
    }

    _onMove(e) {
      if (!this.drag) return;
      const p = this._toSvg(e);
      this.pos[this.drag.id] = { x: p.x, y: p.y };
      this._draw();
    }

    _endDrag() {
      if (!this.drag) return;
      this.drag = null;
      this.svg.classList.remove('dragging');
      this._fit();
    }

    /** Fit the viewBox around all drawn content. */
    _fit() {
      const ids = this.data && this.data.states.length ? this.data.states : null;
      if (!ids) {
        this.svg.setAttribute('viewBox', '0 0 400 240');
        return;
      }
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      try {
        const bb = this.svg.getBBox();
        if (bb.width > 0) {
          x0 = bb.x;
          y0 = bb.y;
          x1 = bb.x + bb.width;
          y1 = bb.y + bb.height;
        }
      } catch (e) {
        /* getBBox fails while hidden — fall back to node positions */
      }
      for (const s of ids) {
        const p = this.pos[s];
        x0 = Math.min(x0, p.x - R - 50);
        x1 = Math.max(x1, p.x + R + 10);
        y0 = Math.min(y0, p.y - R - 70);
        y1 = Math.max(y1, p.y + R + 24);
      }
      const pad = 16;
      const w = Math.max(x1 - x0 + 2 * pad, 300);
      const h = Math.max(y1 - y0 + 2 * pad, 200);
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      this.svg.setAttribute('viewBox', `${cx - w / 2} ${cy - h / 2} ${w} ${h}`);
    }

    /** Standalone SVG text (with inline styles) for download. */
    toSVGString() {
      const clone = this.svg.cloneNode(true);
      clone.setAttribute('xmlns', NS);
      const style = document.createElementNS(NS, 'style');
      style.textContent = `
        .edge{fill:none;stroke:#475569;stroke-width:1.6}.arrow{fill:#475569}
        .edge.hl{stroke:#ea580c;stroke-width:2.6}.arrow.hl{fill:#ea580c}
        .edge-label{font:600 13px sans-serif;fill:#0f172a;paint-order:stroke;stroke:#fff;stroke-width:4px}
        .start-label{font:11px sans-serif;fill:#64748b}
        .node .outer,.node .inner{fill:#fff;stroke:#1e293b;stroke-width:1.8}
        .node.hl .outer{fill:#fed7aa;stroke:#ea580c}.node.dead .outer{stroke-dasharray:4 3}
        .node-label{font:600 14px sans-serif;fill:#0f172a}.node-sub{font:11px monospace;fill:#475569}`;
      clone.insertBefore(style, clone.firstChild);
      return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
    }
  }

  root.GraphView = GraphView;
})(typeof self !== 'undefined' ? self : this);
