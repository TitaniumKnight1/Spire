import type { BookListItem } from "@shared/library-types";

export type SeriesGroup = { label: string; books: BookListItem[] };

export function groupBooksForSeriesView(books: BookListItem[]): SeriesGroup[] {
  const map = new Map<string, BookListItem[]>();
  for (const b of books) {
    const raw = b.series?.trim();
    const key = raw ? raw : "__unsorted__";
    const list = map.get(key);
    if (list) {
      list.push(b);
    } else {
      map.set(key, [b]);
    }
  }
  const entries = [...map.entries()];
  entries.sort((a, b) => {
    if (a[0] === "__unsorted__") {
      return 1;
    }
    if (b[0] === "__unsorted__") {
      return -1;
    }
    return a[0].localeCompare(b[0], undefined, { sensitivity: "base" });
  });
  return entries.map(([key, groupBooks]) => ({
    label: key === "__unsorted__" ? "Unsorted" : key,
    books: [...groupBooks].sort(compareWithinSeries),
  }));
}

function compareWithinSeries(a: BookListItem, b: BookListItem): number {
  const ao = a.series_order;
  const bo = b.series_order;
  if (ao == null && bo == null) {
    return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  }
  if (ao == null) {
    return 1;
  }
  if (bo == null) {
    return -1;
  }
  if (ao !== bo) {
    return ao - bo;
  }
  return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
}
