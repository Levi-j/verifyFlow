export interface PageQuery {
  page?: number;
  size?: number;
  sort?: string;
}

export function pageParams({ page, size, sort }: PageQuery): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  if (page !== undefined) {
    params.page = page;
  }
  if (size !== undefined) {
    params.size = size;
  }
  if (sort !== undefined) {
    params.sort = sort;
  }
  return params;
}
