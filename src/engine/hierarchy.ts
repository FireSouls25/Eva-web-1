import { HOURS_PER_MONTH } from './constants';

export type NodeType = 'SUBESTACION' | 'CIRCUITO' | 'TRAFO' | 'MEDIDOR';

export interface TopologyRow {
  nodeId: string;
  type: NodeType;
  parentId: string | null;
  from: number; // epoch seconds
  to: number; // epoch seconds
}

export interface Assignment {
  trafo: string;
  fromHour: number;
  toHour: number;
}

export class ValidityIndex {
  private byMeter = new Map<string, Assignment[]>();

  add(meterId: string, a: Assignment): void {
    let list = this.byMeter.get(meterId);
    if (!list) {
      list = [];
      this.byMeter.set(meterId, list);
    }
    list.push(a);
  }

  finalize(): void {
    for (const list of this.byMeter.values()) list.sort((x, y) => x.fromHour - y.fromHour);
  }

  parentAt(meterId: string, hour: number): string | null {
    const list = this.byMeter.get(meterId);
    if (!list) return null;
    let lo = 0;
    let hi = list.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].fromHour <= hour) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (ans === -1 || hour >= list[ans].toHour) return null;
    return list[ans].trafo;
  }
}

export interface TreeNode {
  id: string;
  type: NodeType;
  children: TreeNode[];
  tin: number; // Euler-tour entry index
  tout: number; // Euler-tour exit index
  hourly: Float64Array; // own + subtree energy per hour (size 720)
  prefix: Float64Array; // prefix sums over hourly (size 721)
}

export function buildTree(rows: TopologyRow[]): { roots: TreeNode[]; byId: Map<string, TreeNode> } {
  const byId = new Map<string, TreeNode>();
  const ensure = (id: string, type: NodeType): TreeNode => {
    let n = byId.get(id);
    if (!n) {
      n = { id, type, children: [], tin: -1, tout: -1, hourly: new Float64Array(HOURS_PER_MONTH), prefix: new Float64Array(HOURS_PER_MONTH + 1) };
      byId.set(id, n);
    }
    return n;
  };
  for (const r of rows) {
    const node = ensure(r.nodeId, r.type);
    if (r.parentId) {
      const parent = ensure(r.parentId, guessParentType(r.type));
      if (!parent.children.includes(node)) parent.children.push(node);
    }
  }
  const roots: TreeNode[] = [];
  const isChild = new Set<TreeNode>();
  for (const n of byId.values()) for (const c of n.children) isChild.add(c);
  for (const n of byId.values()) if (!isChild.has(n)) roots.push(n);
  // Euler tour numbering (DFS order) — enables BIT / range queries.
  let timer = 0;
  const dfs = (n: TreeNode): void => {
    n.tin = timer++;
    for (const c of n.children) dfs(c);
    n.tout = timer - 1;
  };
  for (const r of roots) dfs(r);
  return { roots, byId };
}

function guessParentType(t: NodeType): NodeType {
  if (t === 'MEDIDOR') return 'TRAFO';
  if (t === 'TRAFO') return 'CIRCUITO';
  return 'SUBESTACION';
}

export function aggregateUp(node: TreeNode): void {
  for (const c of node.children) {
    aggregateUp(c);
    for (let h = 0; h < HOURS_PER_MONTH; h++) node.hourly[h] += c.hourly[h];
  }
  node.prefix[0] = 0;
  for (let h = 0; h < HOURS_PER_MONTH; h++) node.prefix[h + 1] = node.prefix[h] + node.hourly[h];
}

export function subtreeEnergy(node: TreeNode, a: number, b: number): number {
  const lo = Math.max(0, a);
  const hi = Math.min(HOURS_PER_MONTH - 1, b);
  if (hi < lo) return 0;
  return node.prefix[hi + 1] - node.prefix[lo];
}
