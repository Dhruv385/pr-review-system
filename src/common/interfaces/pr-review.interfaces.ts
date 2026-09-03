export enum Platform {
  GITHUB = 'GITHUB',
  GITLAB = 'GITLAB',
}

export enum PullRequestStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  MERGED = 'MERGED',
}

export enum ReviewState {
  APPROVED = 'APPROVED',
  CHANGES_REQUESTED = 'CHANGES_REQUESTED',
  COMMENTED = 'COMMENTED',
  PENDING = 'PENDING',
  DISMISSED = 'DISMISSED',
}

/**
 * Replace with your project's real `IUser` if it already exists —
 * this is only here so the file set is self-contained.
 */
export interface IUser {
  id: string;
  email: string;
}

/** Normalized shape both GithubService and GitlabService map their raw API data into. */
export interface NormalizedPullRequest {
  externalId: string;
  platform: Platform;
  number: number;
  title: string;
  description: string | null;
  repositoryId: string;
  repositoryName: string;
  repositoryFullName: string;
  status: PullRequestStatus;
  authorName: string;
  url: string;
}

export interface NormalizedReview {
  externalId: string;
  reviewerName: string;
  reviewerAvatarUrl: string | null;
  state: ReviewState;
  comment: string | null;
  submittedAt: Date | null;
}

/** Result of a provider sync pass, used for logging/metrics and error surfacing. */
export interface SyncResult {
  synced: boolean;
  reason?: 'FRESH' | 'NO_ACCOUNT' | 'SYNCED' | 'PROVIDER_ERROR';
}
