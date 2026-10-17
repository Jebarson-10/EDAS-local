import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  haversineKm,
  type ExamWorkspace,
  type WorkspaceStandard,
} from "@exam-duty/shared";

export default function WorkspaceMap({
  workspace,
  standard,
}: {
  workspace: ExamWorkspace;
  standard: WorkspaceStandard;
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const [selected, setSelected] = useState("");
  const [streets, setStreets] = useState(false);
  const [tileError, setTileError] = useState(false);
  const schools = useMemo(
    () =>
      workspace.schools.filter(
        (s) => s.latitude != null && s.longitude != null,
      ),
    [workspace.schools],
  );
  const chosen = schools.find((s) => s.udise === selected);
  const nearby = chosen
    ? schools.filter(
        (s) =>
          haversineKm(
            chosen.latitude!,
            chosen.longitude!,
            s.latitude!,
            s.longitude!,
          ) <= 10,
      ).length
    : 0;
  useEffect(() => {
    if (!host.current) return;
    const view = L.map(host.current, {
      scrollWheelZoom: false,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
    }).setView([11.35, 77.7], 10);
    map.current = view;
    L.control.scale({ imperial: false }).addTo(view);
    return () => {
      view.stop();
      view.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const view = map.current;
    if (!view) return;
    const layer = L.layerGroup().addTo(view);
    const centres = new Set(
      workspace.centres
        .filter((c) => c.standard === standard)
        .map((c) => c.udise),
    );
    for (const school of schools) {
      const content = document.createElement("div");
      content.textContent = `${school.name} · UDISE ${school.udise} · ${school.block}`;
      L.circleMarker([school.latitude!, school.longitude!], {
        radius: centres.has(school.udise) ? 7 : 4,
        color: centres.has(school.udise) ? "#bc5718" : "#183B4C",
        fillOpacity: 0.8,
      })
        .bindPopup(content)
        .on("click", () => setSelected(school.udise))
        .addTo(layer);
    }
    if (schools.length)
      view.fitBounds(
        L.latLngBounds(schools.map((s) => [s.latitude!, s.longitude!])),
        { padding: [24, 24], maxZoom: 13 },
      );
    return () => {
      layer.remove();
    };
  }, [schools, workspace.centres, standard]);
  useEffect(() => {
    if (!chosen || !map.current) return;
    const circle = L.circle([chosen.latitude!, chosen.longitude!], {
      radius: 10000,
      color: "#183B4C",
      weight: 2,
      fillOpacity: 0.07,
    }).addTo(map.current);
    map.current.fitBounds(circle.getBounds(), { padding: [16, 16] });
    return () => {
      circle.remove();
    };
  }, [chosen]);
  useEffect(() => {
    if (!streets || !map.current) return;
    const tiles = L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
        referrerPolicy: "strict-origin-when-cross-origin",
      },
    )
      .on("tileerror", () => setTileError(true))
      .addTo(map.current);
    return () => {
      tiles.remove();
    };
  }, [streets]);
  return (
    <section className="space-y-3" aria-label="School location map">
      <p className="text-sm text-slate-600">
        Select a school to see its 10 km circle. Orange pins are {standard}th
        centres; blue pins are other schools. Pins and distance work offline.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="w-full min-w-0 text-sm sm:max-w-xl">
          School{" "}
          <select
            aria-label="Map school"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="w-full min-w-0 rounded border bg-white p-2"
          >
            <option value="">All schools</option>
            {schools.map((s) => (
              <option key={s.udise} value={s.udise}>
                {s.name} ({s.udise})
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <input
            type="checkbox"
            checked={streets}
            onChange={(e) => {
              setStreets(e.target.checked);
              setTileError(false);
            }}
          />{" "}
          Show street map (internet)
        </label>
      </div>
      <div
        ref={host}
        className="relative z-0 h-[430px] rounded-lg border bg-slate-100"
      />
      <p className="text-sm">
        {schools.length} schools have coordinates.{" "}
        {workspace.schools.length - schools.length} need coordinates.
        {chosen
          ? ` ${chosen.name}: ${nearby} schools, including itself, within 10 km.`
          : ""}
      </p>
      {tileError && (
        <p role="status" className="text-sm text-amber-800">
          Street tiles could not load. School pins and distance checks are still
          available.
        </p>
      )}
    </section>
  );
}
