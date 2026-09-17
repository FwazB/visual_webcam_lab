/** A zero-gain peaking filter is transparent; a low-Q notch is not a bypass. */
export function configureHumFilter(filter: BiquadFilterNode, enabled: boolean): void {
  filter.type = enabled ? "notch" : "peaking";
  filter.frequency.value = 60;
  filter.Q.value = 30;
  filter.gain.value = 0;
}
