/**
 * Build the compact, offline address lookup pack used by the desktop app.
 *
 * Usage:
 * node scripts/build-offline-geocode-index.mjs <extract.gpkg> [output.json]
 *
 * Input is an OpenStreetMap GeoPackage extract.  The raw extract is deliberately
 * never committed: this writes only named, searchable point features and their
 * WGS84 coordinates.  See OpenStreetMap's ODbL attribution requirements.
 */
import Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const [input, output = "frontend/public/offline-geocode-index.json"] = process.argv.slice(2);
if (!input) throw new Error("Usage: node scripts/build-offline-geocode-index.mjs <extract.gpkg> [output.json]");

function point(buffer) {
  // GeoPackage header is 8 bytes, followed by little-endian WKB POINT.
  if (!Buffer.isBuffer(buffer) || buffer.length < 29 || buffer.toString("ascii", 0, 2) !== "GP") return null;
  const wkb = 8;
  if (buffer.readUInt32LE(wkb + 1) !== 1) return null;
  return { longitude: buffer.readDoubleLE(wkb + 5), latitude: buffer.readDoubleLE(wkb + 13) };
}

const db = new Database(resolve(input), { readonly: true });
const rows = db.prepare(`
  SELECT osm_id, name, address, place, other_tags, geom
  FROM points
  WHERE name IS NOT NULL AND trim(name) <> ''
`).all();
const out = [];
for (const row of rows) {
  const coords = point(row.geom);
  if (!coords || !Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) continue;
  const tags = String(row.other_tags ?? "");
  const important = /"amenity"=>"(school|college|university|hospital)"/.test(tags);
  const hasAddress = Boolean(row.address) || /"addr:/.test(tags);
  if (!important && !hasAddress && !row.place) continue;
  out.push({ id: String(row.osm_id), name: String(row.name), address: row.address ?? null, place: row.place ?? null, kind: important ? "education_or_health" : row.place ? "place" : "address", ...coords });
}
out.sort((a, b) => a.name.localeCompare(b.name));
mkdirSync(dirname(resolve(output)), { recursive: true });
writeFileSync(resolve(output), JSON.stringify({
  format: "erode-osm-offline-geocode-index-v1",
  attribution: "© OpenStreetMap contributors, ODbL",
  generatedAt: new Date().toISOString(),
  records: out,
}, null, 2));
console.log(`Wrote ${out.length} searchable offline places to ${resolve(output)}`);
