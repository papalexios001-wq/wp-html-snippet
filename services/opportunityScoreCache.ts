import { WordPressPost } from '../types';

const CACHE_KEY = 'opportunityScoresCache';
const CACHE_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CachedScore {
  id: number;
  opportunityScore: number;
  opportunityRationale: string;
  timestamp: number;
}

// Store scores as a map for quick lookups
type ScoreCache = Record<number, CachedScore>;

/**
 * Retrieves all valid scores from localStorage.
 * @returns A record mapping post IDs to their cached score data.
 */
export function getScores(): ScoreCache {
  try {
    const cachedItem = localStorage.getItem(CACHE_KEY);
    if (!cachedItem) return {};

    const cachedScores: ScoreCache = JSON.parse(cachedItem);
    const now = Date.now();
    const validScores: ScoreCache = {};

    for (const postId in cachedScores) {
      const score = cachedScores[postId];
      if (now - score.timestamp < CACHE_EXPIRATION_MS) {
        validScores[postId] = score;
      }
    }
    
    // As a form of garbage collection, we can re-save the cache with only the valid scores.
    // This prevents the cache file from growing indefinitely with expired data.
    if (Object.keys(validScores).length < Object.keys(cachedScores).length) {
        localStorage.setItem(CACHE_KEY, JSON.stringify(validScores));
    }

    return validScores;
  } catch (error) {
    console.error("Failed to read opportunity scores from cache:", error);
    // In case of error, clear the corrupted cache to prevent future issues.
    localStorage.removeItem(CACHE_KEY);
    return {};
  }
}

/**
 * Adds new scores to the cache in localStorage.
 * @param newScores An array of partial post objects containing new scores to cache.
 */
export function addScores(newScores: Partial<WordPressPost>[]): void {
  try {
    const existingScores = getScores();
    const now = Date.now();

    newScores.forEach(scoreData => {
      if (scoreData.id !== undefined && scoreData.opportunityScore !== undefined && scoreData.opportunityRationale !== undefined) {
        existingScores[scoreData.id] = {
          id: scoreData.id,
          opportunityScore: scoreData.opportunityScore,
          opportunityRationale: scoreData.opportunityRationale,
          timestamp: now,
        };
      }
    });

    localStorage.setItem(CACHE_KEY, JSON.stringify(existingScores));
  } catch (error) {
    console.error("Failed to save opportunity scores to cache:", error);
  }
}
