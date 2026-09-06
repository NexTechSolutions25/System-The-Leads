export type CountryCode = "BR" | "PY";
export type Language = "pt-BR" | "es" | "both";
export interface LeadSearchInput {
  country: CountryCode;
  region: string;
  city: string;
  segment: string;
  keyword: string;
  language: Language;
  pageToken?: string;
}
export interface ExternalLead {
  externalId: string;
  provider: string;
  name: string;
  country: CountryCode;
  region: string;
  city: string;
  address?: string;
  category?: string;
  segment?: string;
  description?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  website?: string;
  instagram?: string;
  latitude?: number;
  longitude?: number;
  hours?: string[];
  rating?: number;
  reviewCount?: number;
  sourceUrl?: string;
  collectedAt: string;
  demo: boolean;
  taxId?: string;
  attributions?: unknown[];
}
export interface ExternalLeadDetails extends ExternalLead {}
export interface LeadProvider {
  name: string;
  supportedCountries: string[];
  searchCompanies(input: LeadSearchInput): Promise<ExternalLead[]>;
  getCompanyDetails(externalId: string): Promise<ExternalLeadDetails>;
  nextPageToken?: string;
}
export interface Campaign {
  id: string;
  name: string;
  country: CountryCode;
  region: string;
  cities: string[];
  scope: "city" | "custom" | "region" | "national";
  segment: string;
  keywords: string[];
  service: string;
  maxLeads: number;
  minScore: number;
  language: Language;
  maxRequests: number;
  maxCost: number;
  schedule?: {
    frequency: "daily" | "weekly";
    days: number[];
    time: string;
    timezone: string;
  };
}
export interface Evidence {
  check: string;
  finding: string;
  url?: string;
  at: string;
}
export interface Analysis {
  status: string;
  evidence: Evidence[];
  https?: boolean;
  responseMs?: number;
  title?: string;
  description?: string;
  mobile?: boolean;
  whatsapp?: string;
  email?: string;
  instagram?: string;
  contactForm?: boolean;
  catalog?: boolean;
  services?: boolean;
  cta?: boolean;
  language?: string;
  businessInfo?: boolean;
  technologies?: string[];
  brokenLinks?: string[];
}
export interface Qualification {
  score: number;
  priority: string;
  completeness: number;
  opportunity: string;
  evidence: Evidence[];
  service: string;
  rationale: string;
  messages: { language: string; text: string }[];
  questions: string[];
  language: Language;
}
