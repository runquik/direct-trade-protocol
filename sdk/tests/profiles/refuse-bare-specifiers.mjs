// Module resolution hook for entrypoints.test.ts: a plain ESM environment in which no package
// can be resolved. Only relative, absolute, file:, data: and node: specifiers pass; a bare
// specifier such as a package name is refused before Node looks for node_modules at all.
export async function resolve(specifier, context, next) {
  if (!/^(?:node:|file:|data:|\.{1,2}\/|\/)/.test(specifier)) {
    throw new Error(`REFUSED_BARE_SPECIFIER ${specifier} (imported from ${context.parentURL ?? 'the entry'})`);
  }
  return next(specifier, context);
}
