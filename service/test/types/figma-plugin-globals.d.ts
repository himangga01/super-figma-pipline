// Ambient declaration for `tsconfig.tools.json` only. Root tests import the Figma plugin sources,
// which use the `figma` global. The plugin package's own tsconfig loads @figma/plugin-typings'
// index.d.ts, but that file also redeclares setTimeout, setInterval and console with Figma's
// signatures, which would break the Node sources in the same program. The tools program therefore
// loads only plugin-api.d.ts, which declares the global types, and declares the global here.
declare const figma: PluginAPI;
