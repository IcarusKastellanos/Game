export interface GraphNode {
  id: string;
  x: number;
  y: number;
  title: string;
  subtitle?: string;
  tone?: 'default' | 'core' | 'input' | 'output' | 'end';
  data?: unknown;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface NodeGraphOptions {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onChange?: (nodes: GraphNode[], edges: GraphEdge[]) => void;
  onNodeSelect?: (node: GraphNode | null) => void;
  onEdgeSelect?: (edge: GraphEdge | null) => void;
  allowAddNode?: boolean;
  allowDelete?: boolean;
  newNodeTitle?: string;
}

const NODE_W = 168;
const NODE_H = 72;

/** Lightweight draggable node graph for dialogue trees and spell effect flows. */
export class NodeGraph {
  private root: HTMLElement;
  private canvas: HTMLElement;
  private svg: SVGSVGElement;
  private nodes: GraphNode[] = [];
  private edges: GraphEdge[] = [];
  private selectedNodeId: string | null = null;
  private selectedEdgeId: string | null = null;
  private drag: { id: string; ox: number; oy: number } | null = null;
  private opts: NodeGraphOptions;

  constructor(container: HTMLElement, opts: NodeGraphOptions) {
    this.opts = opts;
    this.nodes = opts.nodes.map((n) => ({ ...n }));
    this.edges = opts.edges.map((e) => ({ ...e }));

    this.root = document.createElement('div');
    this.root.className = 'node-graph';
    container.appendChild(this.root);

    const toolbar = document.createElement('div');
    toolbar.className = 'node-graph-toolbar';
    if (opts.allowAddNode !== false) {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'btn secondary';
      addBtn.textContent = opts.newNodeTitle ? `+ ${opts.newNodeTitle}` : '+ Node';
      addBtn.onclick = () => this.addNode();
      toolbar.appendChild(addBtn);
    }
    if (opts.allowDelete !== false) {
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn danger secondary';
      delBtn.textContent = 'Delete Selected';
      delBtn.onclick = () => this.deleteSelected();
      toolbar.appendChild(delBtn);
    }
    const fitBtn = document.createElement('button');
    fitBtn.type = 'button';
    fitBtn.className = 'btn secondary';
    fitBtn.textContent = 'Auto Layout';
    fitBtn.onclick = () => this.autoLayout();
    toolbar.appendChild(fitBtn);
    this.root.appendChild(toolbar);

    this.canvas = document.createElement('div');
    this.canvas.className = 'node-graph-canvas';
    this.root.appendChild(this.canvas);

    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.classList.add('node-graph-edges');
    this.canvas.appendChild(this.svg);

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.target === this.canvas || e.target === this.svg) {
        this.selectNode(null);
        this.selectEdge(null);
      }
    });

    this.render();
  }

  getNodes(): GraphNode[] {
    return this.nodes.map((n) => ({ ...n }));
  }

  getEdges(): GraphEdge[] {
    return this.edges.map((e) => ({ ...e }));
  }

  setData(nodes: GraphNode[], edges: GraphEdge[]): void {
    this.nodes = nodes.map((n) => ({ ...n }));
    this.edges = edges.map((e) => ({ ...e }));
    this.render();
  }

  updateNode(id: string, patch: Partial<GraphNode>): void {
    const node = this.nodes.find((n) => n.id === id);
    if (!node) return;
    Object.assign(node, patch);
    this.render();
    this.emitChange();
  }

  destroy(): void {
    this.root.remove();
  }

  private emitChange(): void {
    this.opts.onChange?.(this.getNodes(), this.getEdges());
  }

  private addNode(): void {
    const id = `node_${Date.now().toString(36)}`;
    const node: GraphNode = {
      id,
      x: 40 + this.nodes.length * 24,
      y: 40 + this.nodes.length * 24,
      title: id,
      subtitle: 'New dialogue line',
      tone: 'default',
      data: { id, text: '', choices: [] },
    };
    this.nodes.push(node);
    this.render();
    this.selectNode(id);
    this.emitChange();
  }

  private deleteSelected(): void {
    if (this.selectedEdgeId) {
      this.edges = this.edges.filter((e) => e.id !== this.selectedEdgeId);
      this.selectedEdgeId = null;
      this.render();
      this.emitChange();
      return;
    }
    if (!this.selectedNodeId) return;
    const id = this.selectedNodeId;
    this.nodes = this.nodes.filter((n) => n.id !== id);
    this.edges = this.edges.filter((e) => e.from !== id && e.to !== id);
    this.selectedNodeId = null;
    this.render();
    this.opts.onNodeSelect?.(null);
    this.emitChange();
  }

  private autoLayout(): void {
    const layers = new Map<string, number>();
    const start = this.nodes.find((n) => n.id === 'start') ?? this.nodes[0];
    if (!start) return;

    const queue: { id: string; depth: number }[] = [{ id: start.id, depth: 0 }];
    const seen = new Set<string>();
    while (queue.length) {
      const { id, depth } = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      layers.set(id, Math.max(layers.get(id) ?? 0, depth));
      for (const e of this.edges.filter((x) => x.from === id)) {
        queue.push({ id: e.to, depth: depth + 1 });
      }
    }

    const byLayer = new Map<number, string[]>();
    for (const node of this.nodes) {
      const layer = layers.get(node.id) ?? 0;
      if (!byLayer.has(layer)) byLayer.set(layer, []);
      byLayer.get(layer)!.push(node.id);
    }

    for (const node of this.nodes) {
      const layer = layers.get(node.id) ?? 0;
      const row = byLayer.get(layer) ?? [node.id];
      const index = row.indexOf(node.id);
      node.x = 48 + layer * 220;
      node.y = 48 + index * 110;
    }
    this.render();
    this.emitChange();
  }

  private selectNode(id: string | null): void {
    this.selectedNodeId = id;
    this.selectedEdgeId = null;
    this.renderNodes();
    const node = id ? this.nodes.find((n) => n.id === id) ?? null : null;
    this.opts.onNodeSelect?.(node);
  }

  private selectEdge(id: string | null): void {
    this.selectedEdgeId = id;
    this.selectedNodeId = null;
    this.renderNodes();
    this.renderEdges();
    const edge = id ? this.edges.find((e) => e.id === id) ?? null : null;
    this.opts.onEdgeSelect?.(edge);
  }

  private render(): void {
    this.renderEdges();
    this.renderNodes();
  }

  private renderEdges(): void {
    const maxX = Math.max(640, ...this.nodes.map((n) => n.x + NODE_W + 40));
    const maxY = Math.max(420, ...this.nodes.map((n) => n.y + NODE_H + 40));
    this.canvas.style.minWidth = `${maxX}px`;
    this.canvas.style.minHeight = `${maxY}px`;
    this.svg.setAttribute('width', String(maxX));
    this.svg.setAttribute('height', String(maxY));
    this.svg.innerHTML = '';

    for (const edge of this.edges) {
      const from = this.nodes.find((n) => n.id === edge.from);
      const to = this.nodes.find((n) => n.id === edge.to);
      if (!from || !to) continue;

      const x1 = from.x + NODE_W / 2;
      const y1 = from.y + NODE_H;
      const x2 = to.x + NODE_W / 2;
      const y2 = to.y;
      const midY = (y1 + y2) / 2;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute(
        'd',
        `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`
      );
      path.classList.add('node-edge');
      if (edge.id === this.selectedEdgeId) path.classList.add('selected');
      path.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectEdge(edge.id);
      });
      this.svg.appendChild(path);

      if (edge.label) {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', String((x1 + x2) / 2));
        text.setAttribute('y', String(midY - 4));
        text.classList.add('node-edge-label');
        text.textContent = edge.label.length > 28 ? `${edge.label.slice(0, 28)}…` : edge.label;
        this.svg.appendChild(text);
      }
    }
  }

  private renderNodes(): void {
    this.canvas.querySelectorAll('.graph-node').forEach((el) => el.remove());
    for (const node of this.nodes) {
      const el = document.createElement('div');
      el.className = `graph-node tone-${node.tone ?? 'default'}`;
      if (node.id === this.selectedNodeId) el.classList.add('selected');
      el.style.left = `${node.x}px`;
      el.style.top = `${node.y}px`;
      el.innerHTML = `
        <div class="graph-node-title">${node.title}</div>
        <div class="graph-node-sub">${node.subtitle ?? ''}</div>`;

      el.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.selectNode(node.id);
        this.drag = { id: node.id, ox: e.clientX - node.x, oy: e.clientY - node.y };
      });
      this.canvas.appendChild(el);
    }
  }

  handlePointerMove(clientX: number, clientY: number): void {
    if (!this.drag) return;
    const node = this.nodes.find((n) => n.id === this.drag!.id);
    if (!node) return;
    const rect = this.canvas.getBoundingClientRect();
    node.x = Math.max(8, clientX - rect.left - this.drag.ox + this.canvas.scrollLeft);
    node.y = Math.max(8, clientY - rect.top - this.drag.oy + this.canvas.scrollTop);
    this.render();
  }

  handlePointerUp(): void {
    if (this.drag) {
      this.drag = null;
      this.emitChange();
    }
  }

  bindPointerHandlers(): () => void {
    const onMove = (e: MouseEvent) => this.handlePointerMove(e.clientX, e.clientY);
    const onUp = () => this.handlePointerUp();
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }
}

export function dialogueToGraph(tree: {
  nodes: { id: string; text: string; choices: { label: string; next: string }[] }[];
}): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = tree.nodes.map((n, i) => ({
    id: n.id,
    x: 48 + (i % 3) * 220,
    y: 48 + Math.floor(i / 3) * 120,
    title: n.id,
    subtitle: n.text.slice(0, 48) + (n.text.length > 48 ? '…' : ''),
    tone: n.id === 'start' ? 'core' : n.id === 'end' ? 'end' : 'default',
    data: n,
  }));
  const edges: GraphEdge[] = [];
  for (const node of tree.nodes) {
    node.choices.forEach((choice, ci) => {
      edges.push({
        id: `${node.id}:${ci}`,
        from: node.id,
        to: choice.next,
        label: choice.label,
      });
    });
  }
  return { nodes, edges };
}

export function graphToDialogue(
  treeId: string,
  npcId: string,
  nodes: GraphNode[],
  edges: GraphEdge[]
): { id: string; npcId: string; nodes: { id: string; text: string; choices: unknown[] }[] } {
  const edgeMap = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    if (!edgeMap.has(edge.from)) edgeMap.set(edge.from, []);
    edgeMap.get(edge.from)!.push(edge);
  }

  return {
    id: treeId,
    npcId,
    nodes: nodes.map((n) => {
      const raw = (n.data ?? {}) as {
        text?: string;
        choices?: {
          label: string;
          next: string;
          relationshipDelta?: number;
          statBoost?: Record<string, number>;
          grantItem?: string;
        }[];
      };
      const linked = edgeMap.get(n.id) ?? [];
      const choices = linked.length
        ? linked.map((e) => {
            const prev = raw.choices?.find((c) => c.next === e.to);
            return {
              label: e.label ?? prev?.label ?? 'Continue',
              next: e.to,
              ...(prev?.relationshipDelta != null ? { relationshipDelta: prev.relationshipDelta } : {}),
              ...(prev?.statBoost ? { statBoost: prev.statBoost } : {}),
              ...(prev?.grantItem ? { grantItem: prev.grantItem } : {}),
            };
          })
        : raw.choices ?? [];
      return { id: n.id, text: raw.text ?? n.subtitle ?? '', choices };
    }),
  };
}

export function spellToGraph(spell: {
  id: string;
  name: string;
  ingredients: { itemId: string; quantity: number }[];
  gameplayEffect: Record<string, unknown>;
}): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const coreX = 280;
  const coreY = 160;

  nodes.push({
    id: 'spell_core',
    x: coreX,
    y: coreY,
    title: spell.name || spell.id || 'Spell',
    subtitle: 'Core working',
    tone: 'core',
    data: { type: 'core' },
  });

  spell.ingredients.forEach((ing, i) => {
    const id = `ing_${ing.itemId}`;
    nodes.push({
      id,
      x: 40 + i * 120,
      y: 40,
      title: ing.itemId,
      subtitle: `×${ing.quantity}`,
      tone: 'input',
      data: ing,
    });
    edges.push({ id: `e_${id}`, from: id, to: 'spell_core', label: 'reagent' });
  });

  const effects = Object.entries(spell.gameplayEffect ?? {});
  effects.forEach(([key, val], i) => {
    const id = `fx_${key}`;
    nodes.push({
      id,
      x: 80 + i * 150,
      y: 300,
      title: key,
      subtitle: String(val),
      tone: 'output',
      data: { key, value: val },
    });
    edges.push({ id: `e_${id}`, from: 'spell_core', to: id, label: 'effect' });
  });

  return { nodes, edges };
}

export function graphEffectsToRecord(nodes: GraphNode[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const node of nodes) {
    if (!node.id.startsWith('fx_')) continue;
    const data = node.data as { key?: string; value?: unknown };
    const key = data.key ?? node.id.slice(3);
    let value: unknown = data.value ?? node.subtitle;
    if (typeof value === 'string' && value !== '' && !Number.isNaN(Number(value))) {
      value = Number(value);
    }
    out[key] = value;
  }
  return out;
}
