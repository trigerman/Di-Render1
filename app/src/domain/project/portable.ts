import { verifyDataSourceHashes } from "../data/source";
import { parseBoundedJson } from "../security/input";
import { migrateProject } from "./migrations";
import type { OpenBioFigureProject } from "./schema";

/** All validation completes before the caller switches away from the current figure. */
export function readPortableProject(contents: string): OpenBioFigureProject {
  const project = migrateProject(parseBoundedJson(contents));
  verifyDataSourceHashes(project.dataSources);
  return project;
}
