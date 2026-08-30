// Wire + normalized shapes for the AMC Outdoors Connector feed.
// Presence counts verified against a live 601-row response, 2026-08-30.
// Salesforce OMITS absent fields rather than sending null, so optional
// members are genuinely absent. No `| null` unions anywhere.

export type ActivityStatus = 'Published' | 'Full' | 'Waitlist';
export type RegistrationType = 'Show & Go' | 'Registration' | 'Application';

/** Salesforce compound address. Every subkey optional — many rows carry only `country`. */
export interface SalesforceAddress {
  street?: string;
  city?: string;
  state?: string;
  stateCode?: string;
  postalCode?: string;
  country?: string;
  countryCode?: string;
}

export interface RawCost {
  Id: string;
  Name: string;
  OC_Activity__c: string;
  Amount__c: number;
}

export interface RawLeader {
  Id: string;
  OC_Activity__c: string;
  Contact__c: string;
  Contact__r: { Id: string; Name: string };
}

/** Exactly what the Aura endpoint returns. Do not add convenience fields here. */
export interface RawActivity {
  // --- universal: 601/601 ---
  Id: string;
  Account__c: string;
  Activity_Name__c: string;
  Description__c: string;
  Start_Date__c: string;  // YYYY-MM-DD
  End_Date__c: string;    // YYYY-MM-DD; 2 sentinel rows use >= 2050
  Start_Time__c: string;  // free text: "All Day" | "9:00 AM"
  Time_Zone__c: string;   // "US EST"
  Main_Activity_Type__c: string;
  Main_Activity_Sub_Type__c: string;
  Main_Activity_Difficulty_Rating__c: string;  // "4 - Moderate"
  Program_Type__c: string;
  Registration_Type__c: RegistrationType;
  Status__c: ActivityStatus;
  Start_Latitude__c: number;   // 0 when unset (52 rows)
  Start_Longitude__c: number;  // 0 when unset
  Start_Concatenation_Formula_Unconverted__c: string;
  Hide_Start_Location_Until_Registered__c: boolean;
  Online_Event__c: boolean;
  Private_Activity__c: boolean;
  /** NOT an availability signal — observed `true` on rows whose Status__c is `Full`. */
  Open_for_registration__c: boolean;
  Registration_Open_Date_Passed__c: boolean;
  Register_By_Date_Passed__c: boolean;

  // --- partial; count is observed presence out of 601 ---
  Start_Location__c?: SalesforceAddress;          // 599
  OC_Trip_Leaders__r?: RawLeader[];               // 600, max length 1
  Thumbnail_Image_ContentDocumentId__c?: string;  // 504
  Image_File_ID__c?: string;                      // 504
  Secondary_Activity_Type__c?: string;            // 373
  Keywords__c?: string;                           // 354
  Audience_Type__c?: string;                      // 216
  Register_By_Date__c?: string;                   // 137
  Registration_Open_Date__c?: string;             // 132
  Activity_Costs__r?: RawCost[];                  // 45, max length 1
}

/**
 * Slim index row. `Description__c` is deliberately absent — descriptions ship
 * separately in details.json so the committed index stays ~81 KB gzipped.
 */
export interface Activity {
  id: string;
  name: string;
  chapterId: string;
  startDate: string;
  endDate: string;
  startTime: string;
  timeZone: string;
  type: string;
  subType: string;
  secondaryType?: string;
  /** 1–6, parsed from the leading digit of Main_Activity_Difficulty_Rating__c. */
  difficulty: number;
  difficultyLabel: string;
  program: string;
  audience?: string;
  registrationType: RegistrationType;
  status: ActivityStatus;
  openForRegistration: boolean;
  registrationOpenDate?: string;
  registerByDate?: string;
  /** Source caps at 1, but kept plural — no invariant AMC has promised. */
  costs: number[];
  leaders: string[];
  location?: { city?: string; state?: string; country?: string };
  /** Omitted entirely when the source sends 0/0. */
  coords?: { lat: number; lon: number };
  keywords?: string;
  /** Deep link path: /s/oc-activity/{id} */
  url: string;
}

export interface Chapter {
  id: string;
  name: string;
}

/** details.json — id -> raw HTML description. */
export type ActivityDetails = Record<string, string>;
