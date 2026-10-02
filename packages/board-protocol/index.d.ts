export declare const messageTypes: Readonly<Record<string, string>>
export declare function command<T extends string, F extends object>(
  type: T,
  fields?: F
): { type: T } & F
