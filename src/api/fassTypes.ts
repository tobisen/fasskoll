export interface SearchDrugItem {
  id?: string;
  name?: string;
  tradeName?: string;
  [key: string]: unknown;
}

export interface PackageDetails {
  id?: string;
  [key: string]: unknown;
}

export interface InterchangeableMedicinalProduct {
  [key: string]: unknown;
}

export interface InterchangeablePackage {
  [key: string]: unknown;
}

export interface FormStrengthOption {
  id: string;
  label: string;
  strength?: string;
  form?: string;
  manufacturer?: string;
  packageType?: string;
  packageId: string;
}

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  raw: unknown;
}

export interface Pharmacy {
  glnCode: string;
  name?: string;
  address?: string;
  chainName?: string;
  visitingAddress?: {
    streetAddress?: string;
    city?: string;
    postalCode?: string;
  };
  latitude?: number;
  longitude?: number;
  [key: string]: unknown;
}

export interface StockItem {
  exchangeableProductInStock?: boolean;
  glnCode: string;
  stockInformation: string;
  [key: string]: unknown;
}

export interface PharmacyWithStock {
  pharmacy: Pharmacy;
  stock: StockItem | null;
  inStock: boolean;
}

export interface NearbyPharmacyParams {
  latitude: number;
  longitude: number;
  limit?: number;
}

export interface PharmaciesWithStockParams {
  packageId: string;
  zipCode: string;
  limit?: number;
}

