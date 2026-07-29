#!/usr/bin/env ruby
# Uji langkah "Periksa check wajib" di .github/workflows/release.yml.
#
# Jalankan dari akar repo:  ruby scripts/tests/release-gate.rb
# CI menjalankannya di job "Gerbang rilis — uji penjaga" (.github/workflows/ci.yml).
# Blok run:-nya DIEKSTRAK dari YAML (bukan diketik ulang), hanya panggilan `gh api` yang ditukar
# dengan fixture — jadi yang diuji adalah kode yang benar-benar dikirim.
require 'yaml'
require 'json'
require 'tmpdir'

wf = YAML.safe_load(File.read('.github/workflows/release.yml'))
step = wf['jobs']['release']['steps'].find { |s| s['name'].to_s.include?('Periksa check wajib') }
abort 'langkah Periksa tak ditemukan' unless step
raise 'perintah gh api tak ditemukan' unless step['run'] =~ /^\s*gh api /
script = step['run'].gsub(/^(\s*)gh api .*> \/tmp\/runs\.json$/) { "#{$1}cp \"$FIXTURE\" /tmp/runs.json" }
# Cek baris PERINTAH-nya hilang, bukan string "gh api" di mana pun — komentar di dalam blok itu
# ikut menyebut `gh api --paginate`.
raise 'substitusi gh api gagal' if script =~ /^\s*gh api /

def run(name, started_at, status, conclusion)
  { 'name' => name, 'started_at' => started_at, 'status' => status, 'conclusion' => conclusion }
end

GO = 'Go — build, vet, test'
E2E = 'E2E gate'

kasus = [
  ['keduanya hijau',
   [run(GO, '2026-07-29T01:00:00Z', 'completed', 'success'),
    run(E2E, '2026-07-29T01:00:00Z', 'completed', 'success')], 'false', 0],
  ['E2E masih berjalan',
   [run(GO, '2026-07-29T01:00:00Z', 'completed', 'success'),
    run(E2E, '2026-07-29T01:00:00Z', 'in_progress', nil)], 'false', 1],
  ['E2E belum melapor sama sekali',
   [run(GO, '2026-07-29T01:00:00Z', 'completed', 'success')], 'false', 1],
  ['E2E gagal',
   [run(GO, '2026-07-29T01:00:00Z', 'completed', 'success'),
    run(E2E, '2026-07-29T01:00:00Z', 'completed', 'failure')], 'false', 1],
  ['E2E gagal + force=true',
   [run(GO, '2026-07-29T01:00:00Z', 'completed', 'success'),
    run(E2E, '2026-07-29T01:00:00Z', 'completed', 'failure')], 'true', 0],
  ['E2E dibatalkan (run push-to-main yang di-cancel)',
   [run(GO, '2026-07-29T01:00:00Z', 'completed', 'success'),
    run(E2E, '2026-07-29T01:00:00Z', 'completed', 'cancelled')], 'false', 1],
  # Yang paling mudah salah: re-run. Yang lama hijau, yang BARU merah → harus TOLAK.
  ['re-run: lama hijau, baru merah',
   [run(GO, '2026-07-29T01:00:00Z', 'completed', 'success'),
    run(E2E, '2026-07-29T01:00:00Z', 'completed', 'success'),
    run(E2E, '2026-07-29T02:00:00Z', 'completed', 'failure')], 'false', 1],
  ['re-run: lama merah, baru hijau',
   [run(GO, '2026-07-29T01:00:00Z', 'completed', 'success'),
    run(E2E, '2026-07-29T01:00:00Z', 'completed', 'failure'),
    run(E2E, '2026-07-29T02:00:00Z', 'completed', 'success')], 'false', 0],
]

gagal = 0
Dir.mktmpdir do |dir|
  sh = File.join(dir, 'step.sh')
  File.write(sh, script)
  kasus.each do |judul, runs, force, harap|
    fixture = File.join(dir, 'runs.json')
    File.write(fixture, JSON.dump({ 'check_runs' => runs }))
    summary = File.join(dir, 'summary.md')
    File.write(summary, '')
    env = { 'FIXTURE' => fixture, 'SHA' => 'deadbeefcafe', 'FORCE' => force,
            'GITHUB_REPOSITORY' => 'zihar/luna-trade', 'GITHUB_STEP_SUMMARY' => summary }
    out = IO.popen(env, ['bash', sh], err: [:child, :out], &:read)
    kode = $?.exitstatus
    ok = kode == harap
    gagal += 1 unless ok
    puts "#{ok ? 'OK   ' : 'GAGAL'} #{judul} → exit #{kode} (harap #{harap})"
    unless ok
      puts out.lines.map { |l| "        #{l}" }.join
    end
    if force == 'true' && kode.zero?
      catatan = File.read(summary)
      tercatat = catatan.include?('Dipaksa')
      gagal += 1 unless tercatat
      puts "#{tercatat ? 'OK   ' : 'GAGAL'}   ...pemaksaan tercatat di step summary"
    end
  end
end

puts gagal.zero? ? "\nSEMUA LULUS" : "\n#{gagal} GAGAL"
exit(gagal.zero? ? 0 : 1)
