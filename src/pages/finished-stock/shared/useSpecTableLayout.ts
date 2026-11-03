import { computed, nextTick, onUpdated, onBeforeUnmount, ref, watch } from 'vue';
import type { PrimaryTableCol } from 'tdesign-vue-next';

/** Only used by the three terminal specification editors. Keep feedback out of width measurement. */
export function useSpecTableLayout() {
  const tableElement = ref<HTMLElement>();
  const widths = ref<number[]>([]);
  let signature = '';
  let version = 0;
  let disposed = false;
  const contentWidth = computed(() =>
    widths.value.length ? `max(100%, ${widths.value.reduce((sum, width) => sum + width, 0)}px)` : 'max-content',
  );
  const fitColumns = <T extends PrimaryTableCol>(columns: T[]): T[] =>
    columns.map((column, index) => ({
      ...column,
      ...(widths.value.length === columns.length && widths.value[index] ? { width: widths.value[index] } : {}),
    }));
  const layoutSignature = () => {
    const element = tableElement.value;
    return JSON.stringify([
      Array.from(element?.querySelectorAll('thead th') ?? [], (header) => header.textContent),
      element?.querySelectorAll('tbody tr').length,
      Array.from(element?.querySelectorAll('.spec-name-cell') ?? [], (cell) => cell.textContent),
    ]);
  };
  const measure = async () => {
    const current = ++version;
    signature = layoutSignature();
    widths.value = [];
    await nextTick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (disposed || current !== version) return;
    const headers = tableElement.value?.querySelectorAll('thead th');
    if (!headers?.length) return;
    const measured = Array.from(headers, (header) => Math.ceil(header.getBoundingClientRect().width));
    if (measured.every((width) => width > 0)) widths.value = measured;
  };
  watch(
    tableElement,
    (element, _previous, onCleanup) => {
      if (!element) return;
      let previousWidth = element.getBoundingClientRect().width;
      const observer = new ResizeObserver(() => {
        const width = element.getBoundingClientRect().width;
        if (Math.abs(width - previousWidth) < 1) return;
        previousWidth = width;
        void measure();
      });
      observer.observe(element);
      void measure();
      onCleanup(() => {
        observer.disconnect();
        version += 1;
      });
    },
    { flush: 'post' },
  );
  onUpdated(() => {
    if (tableElement.value && signature !== layoutSignature()) void measure();
  });
  onBeforeUnmount(() => {
    disposed = true;
    version += 1;
  });
  return { tableElement, contentWidth, fitColumns };
}
