export type SourceRow = {
  sku: string;
  asin: string;
  fsn: string;
  title: string;
  searchQuery: string;
  amazonUrl: string;
  flipkartUrl: string;
};

export type MarketplaceResult = {
  marketplace: "amazon" | "flipkart";
  ok: boolean;
  blocked: boolean;
  price: number | null;
  currency: string;
  title: string;
  url: string;
  notes: string;
  attempts: number;
};

export type RowResult = {
  sku: string;
  asin: string;
  fsn: string;
  title: string;
  amazon: MarketplaceResult;
  flipkart: MarketplaceResult;
};

export type CheckPricesResponse = {
  checkedAt: string;
  totalRows: number;
  rows: RowResult[];
};
