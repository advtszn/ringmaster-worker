type ExtractTemplateVars<T extends string> =
  T extends `${infer _Start}{{${infer Var}}}${infer Rest}`
    ? Var | ExtractTemplateVars<Rest>
    : never;

export class PromptTemplate<T extends string> {
  private template: T;

  constructor(template: T) {
    this.template = template;
  }

  getTemplate(): T {
    return this.template;
  }

  inject(values: Record<ExtractTemplateVars<T>, string | number>): string {
    let filled = this.template as string;
    for (const [key, value] of Object.entries(values)) {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, "g");
      filled = filled.replace(regex, String(value));
    }
    return filled;
  }
}