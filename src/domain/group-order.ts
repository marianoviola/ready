export function reconcileGroupOrder(saved: string[], visible: string[]): string[] {
  return [...new Set([...saved, ...visible])];
}

export function moveGroup(
  saved: string[],
  visible: string[],
  group: string,
  direction: -1 | 1
): string[] {
  const order = reconcileGroupOrder(saved, visible);
  const displayed = order.filter((key) => visible.includes(key));
  const index = displayed.indexOf(group);
  const target = displayed[index + direction];
  if (index < 0 || target === undefined) return order;
  const from = order.indexOf(group);
  const to = order.indexOf(target);
  [order[from], order[to]] = [order[to], order[from]];
  return order;
}
