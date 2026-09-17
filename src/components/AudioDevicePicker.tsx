"use client";

interface AudioDevicePickerProps {
  devices: MediaDeviceInfo[];
  selectedDeviceId: string | null;
  onSelect: (id: string) => void;
}

export default function AudioDevicePicker({ devices, selectedDeviceId, onSelect }: AudioDevicePickerProps) {
  return (
    <select
      value={selectedDeviceId ?? ""}
      onChange={(e) => e.target.value && onSelect(e.target.value)}
      className="text-[11px] font-mono px-2 py-1 rounded bg-black/60 border border-white/10 text-white max-w-[220px]"
    >
      <option value="">choose input…</option>
      {devices.map((d) => (
        <option key={d.deviceId} value={d.deviceId}>
          {d.label || d.deviceId.slice(0, 8)}
        </option>
      ))}
    </select>
  );
}
