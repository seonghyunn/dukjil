export type ConcertStatus = 'scheduled' | 'attended';

export type ConcertReview = {
  id: string;
  body: string;
  createdAt: string;
};

export type Concert = {
  id: string;
  title: string;
  artists: string[];
  performanceAt: string;
  venue: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  countryCode: string;
  bookingProvider: string;
  sourceUrl: string;
  listPrice: number | null;
  paidAmount: number | null;
  status: ConcertStatus;
  rating: number | null;
  reviews: ConcertReview[];
  posterUrl: string;
  officialPosterUrl?: string;
  posterSource?: 'official' | 'upload';
  posterStoragePath?: string;
};

export type Profile = {
  originConfigured: boolean;
  originName: string;
  originAddress: string;
  originLatitude: number;
  originLongitude: number;
  originCountryCode: string;
};

export type GeocodeCandidate = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  countryCode: string;
};

export type ImportDraft = {
  title: string;
  artists: string[];
  venue: string;
  address: string;
  bookingProvider: string;
  sourceUrl: string;
  posterUrl: string;
  dateCandidates: string[];
  priceCandidates: number[];
  warnings: string[];
};

export type NotionConcertDraft = {
  sourceId: string;
  title: string;
  artists: string[];
  performanceAt: string;
  endDate?: string;
  venue: string;
  bookingProvider: string;
  listPrice: number | null;
  paidAmount: number | null;
  reviews: ConcertReview[];
};
