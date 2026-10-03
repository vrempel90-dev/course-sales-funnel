export const PAGE_SIZE = 5;
export function pageIndex(value: string | number) {
  const text = String(value);
  if (!/^\d{1,5}$/.test(text)) throw new Error("Invalid page");
  return Math.min(Number(text), 10000);
}
export function pagination(total: number, requested: number) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(0, requested), pages - 1);
  return { page, pages, skip: page * PAGE_SIZE, take: PAGE_SIZE, total };
}
