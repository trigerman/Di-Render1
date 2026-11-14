import { sha256 } from '../assets/svgFingerprint';
import type { PreparedObservations } from './observations';
import type { AnalysisConfig } from '../stats/schema';
export const ENGINE_VERSION = 'openrender-stats-1.1.1';
export const analysisFingerprint = (observations: PreparedObservations, config: AnalysisConfig) => sha256(JSON.stringify({ engine: ENGINE_VERSION, groups: observations.groups, exclusions: observations.exclusions, config }));
