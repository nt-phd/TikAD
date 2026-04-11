import type { ComponentDef } from '../types';

export class ComponentRegistry {
  private defs = new Map<string, ComponentDef>();

  register(def: ComponentDef): void {
    this.defs.set(def.id, def);
  }

  get(id: string): ComponentDef | undefined {
    return this.defs.get(id);
  }

  getByCategory(category: string): ComponentDef[] {
    return [...this.defs.values()].filter(d => d.category === category);
  }

  getAll(): ComponentDef[] {
    return [...this.defs.values()];
  }

  getCategories(): string[] {
    return [...new Set([...this.defs.values()].map(d => d.category))];
  }
}

export const registry = new ComponentRegistry();
