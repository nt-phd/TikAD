export class SelectionState {
  private selectedIds = new Set<string>();

  setSelectedIds(ids: string[]): void {
    this.selectedIds = new Set(ids);
  }

  select(id: string): void {
    this.selectedIds.clear();
    this.selectedIds.add(id);
  }

  addToSelection(id: string): void {
    this.selectedIds.add(id);
  }

  deselect(id: string): void {
    this.selectedIds.delete(id);
  }

  clear(): void {
    this.selectedIds.clear();
  }

  toggle(id: string): void {
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
    } else {
      this.selectedIds.add(id);
    }
  }

  isSelected(id: string): boolean {
    return this.selectedIds.has(id);
  }

  getSelectedIds(): string[] {
    return [...this.selectedIds];
  }

  get count(): number {
    return this.selectedIds.size;
  }
}
