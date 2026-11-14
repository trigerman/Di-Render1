import type { BuiltinPlugin } from "../types";
import { myLibraryPlugin } from "./library/MyLibraryPlugin";
import { moleculePlugin } from "./molecule/MoleculePlugin";
import { proteinPlugin } from "./protein/ProteinPlugin";

/** Order here is the order in the Plugins tab. Add new built-ins to this list. */
export const builtinPlugins: BuiltinPlugin[] = [proteinPlugin, moleculePlugin, myLibraryPlugin];
