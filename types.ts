
export enum AppState {
  SETUP,
  INTERVIEWING,
  FEEDBACK,
}

export interface TranscriptTurn {
  speaker: 'Interviewer' | 'Candidate' | 'System';
  text: string;
  isPartial?: boolean;
}

export interface Feedback {
  grade: string;
  feedback: string;
}
