#!/usr/bin/env ruby
# Uji penjaga (a) & (b) di deploy/luna-deploy.sh terhadap repo git NYATA.
#
# Jalankan dari akar repo:  ruby scripts/tests/deploy-guards.rb
# CI menjalankannya di job "Gerbang rilis — uji penjaga" (.github/workflows/ci.yml).
#
# Bagian skrip sampai baris "deploy: X -> Y" DIEKSTRAK dari file aslinya (bukan diketik ulang);
# yang ditukar hanya RUNTIME (→ sandbox) dan `export HOME=/root`. Jadi yang diuji adalah asumsi
# soal perilaku git yang jadi tumpuan penjaga: kode keluar `ls-remote --exit-code`,
# `merge-base --is-ancestor`, dan `git show <sha>:path`.
require 'tmpdir'
require 'fileutils'

src = File.read('deploy/luna-deploy.sh')
batas = src.index('echo "[$(ts)] deploy: ${LOCAL:0:8} -> ${REMOTE:0:8}"')
abort 'baris penanda deploy tak ditemukan' unless batas
prefiks = src[0, batas + src[batas..].index("\n") + 1]
prefiks = prefiks.sub('RUNTIME=/opt/bar-replay', 'RUNTIME="$TEST_RUNTIME"')
prefiks = prefiks.sub('export HOME=/root', ':')
# Cek baris ASSIGNMENT-nya, bukan string "/opt/bar-replay" di mana pun — komentar di kepala file
# ikut menyebut path itu.
abort 'substitusi RUNTIME gagal' unless prefiks =~ /^RUNTIME="\$TEST_RUNTIME"$/
abort 'substitusi HOME gagal' if prefiks =~ /^export HOME=/

def sh(*cmd, dir: nil)
  out = IO.popen(cmd, chdir: dir || Dir.pwd, err: [:child, :out], &:read)
  raise "gagal: #{cmd.join(' ')}\n#{out}" unless $?.success?
  out.strip
end

# Bangun origin bare + tiga commit; deploy/luna-deploy.sh tiap commit menunjuk branch tertentu.
def bangun(dir, branch_di_c1:)
  origin = File.join(dir, 'origin.git')
  kerja  = File.join(dir, 'kerja')
  sh('git', 'init', '--quiet', '--bare', '-b', 'main', origin)
  sh('git', 'init', '--quiet', '-b', 'main', kerja)
  sh('git', 'config', 'user.email', 't@t', dir: kerja)
  sh('git', 'config', 'user.name', 'T', dir: kerja)
  sh('git', 'remote', 'add', 'origin', origin, dir: kerja)
  FileUtils.mkdir_p(File.join(kerja, 'deploy'))
  shas = []
  [branch_di_c1, 'release', 'release'].each_with_index do |br, i|
    # Fixture dibuat semirip skrip asli (BRANCH di atas + beberapa KB isi) supaya perilaku
    # pencocokan diuji pada bentuk yang sama dengan produksi, bukan pada file 2 baris.
    pengisi = (1..400).map { |n| "# baris pengisi #{n} — meniru ukuran skrip asli (~5KB)\n" }.join
    File.write(File.join(kerja, 'deploy/luna-deploy.sh'),
               "#!/usr/bin/env bash\nBRANCH=#{br}\n#{pengisi}")
    File.write(File.join(kerja, 'penanda.txt'), "c#{i + 1}")
    sh('git', 'add', '-A', dir: kerja)
    sh('git', 'commit', '--quiet', '-m', "c#{i + 1}", dir: kerja)
    shas << sh('git', 'rev-parse', 'HEAD', dir: kerja)
  end
  sh('git', 'push', '--quiet', 'origin', 'main', dir: kerja)
  [origin, kerja, shas]
end

# Klon deploy target di sandbox RUNTIME/repo, HEAD dipatok ke `head_sha`.
def siapkan_runtime(dir, origin, head_sha)
  runtime = File.join(dir, 'runtime')
  repo = File.join(runtime, 'repo')
  FileUtils.rm_rf(runtime)
  FileUtils.mkdir_p(runtime)
  sh('git', 'clone', '--quiet', origin, repo)
  sh('git', 'checkout', '--quiet', '--detach', head_sha, dir: repo)
  runtime
end

def jalankan(prefiks, dir, runtime)
  skrip = File.join(dir, 'prefiks.sh')
  File.write(skrip, prefiks)
  out = IO.popen({ 'TEST_RUNTIME' => runtime }, ['bash', skrip], err: [:child, :out], &:read)
  [$?.exitstatus, out]
end

gagal = 0
def periksa(judul, kode, out, harap_kode:, harap_isi: nil, larang_isi: nil)
  ok = kode == harap_kode
  ok &&= out.include?(harap_isi) if harap_isi
  ok &&= !out.include?(larang_isi) if larang_isi
  puts "#{ok ? 'OK   ' : 'GAGAL'} #{judul} → exit #{kode}"
  puts out.lines.map { |l| "        #{l}" }.join unless ok
  ok
end

Dir.mktmpdir do |dir|
  # --- (a) origin/release belum ada -----------------------------------------------------------
  origin, _kerja, shas = bangun(dir, branch_di_c1: 'main')
  runtime = siapkan_runtime(dir, origin, shas[2])
  kode, out = jalankan(prefiks, dir, runtime)
  gagal += 1 unless periksa('(a) origin/release belum ada → keluar 0, tidak gagal', kode, out,
                            harap_kode: 0, harap_isi: 'belum ada', larang_isi: 'deploy:')

  # --- jaringan bermasalah HARUS berisik, bukan diam ------------------------------------------
  rusak = File.join(dir, 'runtime-rusak')
  FileUtils.rm_rf(rusak); FileUtils.mkdir_p(rusak)
  sh('git', 'clone', '--quiet', origin, File.join(rusak, 'repo'))
  sh('git', 'remote', 'set-url', 'origin', File.join(dir, 'tidak-ada.git'), dir: File.join(rusak, 'repo'))
  kode, out = jalankan(prefiks, dir, rusak)
  gagal += 1 unless periksa('origin tak terjangkau → keluar BUKAN 0 (tak boleh senyap)', kode, out,
                            harap_kode: 128, harap_isi: 'ls-remote')

  # --- release == HEAD → no-op ---------------------------------------------------------------
  sh('git', 'push', '--quiet', origin, "#{shas[2]}:refs/heads/release", dir: File.join(dir, 'kerja'))
  runtime = siapkan_runtime(dir, origin, shas[2])
  kode, out = jalankan(prefiks, dir, runtime)
  gagal += 1 unless periksa('release == HEAD → diam, tak ada deploy', kode, out,
                            harap_kode: 0, larang_isi: 'deploy:')

  # --- maju (rilis normal) -------------------------------------------------------------------
  runtime = siapkan_runtime(dir, origin, shas[0])
  kode, out = jalankan(prefiks, dir, runtime)
  gagal += 1 unless periksa('release di depan HEAD (rilis normal) → lanjut deploy', kode, out,
                            harap_kode: 0, harap_isi: 'deploy:')

  # --- (b) mundur ke commit yang skripnya BRANCH=main → TOLAK --------------------------------
  sh('git', 'push', '--quiet', '-f', origin, "#{shas[0]}:refs/heads/release", dir: File.join(dir, 'kerja'))
  runtime = siapkan_runtime(dir, origin, shas[2])
  kode, out = jalankan(prefiks, dir, runtime)
  gagal += 1 unless periksa('(b) mundur ke commit BRANCH=main → TOLAK, tak deploy', kode, out,
                            harap_kode: 1, harap_isi: 'TOLAK mundur', larang_isi: 'deploy:')

  # --- (b) mundur ke commit yang skripnya BRANCH=release → rollback SAH ----------------------
  origin2, kerja2, shas2 = bangun(File.join(dir, 'b2').tap { |d| FileUtils.mkdir_p(d) },
                                  branch_di_c1: 'release')
  sh('git', 'push', '--quiet', origin2, "#{shas2[0]}:refs/heads/release", dir: kerja2)
  runtime = siapkan_runtime(File.join(dir, 'b2'), origin2, shas2[2])
  kode, out = jalankan(prefiks, File.join(dir, 'b2'), runtime)
  gagal += 1 unless periksa('(b) rollback ke commit BRANCH=release → DIIZINKAN', kode, out,
                            harap_kode: 0, harap_isi: 'rollback disengaja')
  gagal += 1 unless periksa('   ...dan benar-benar lanjut deploy', kode, out,
                            harap_kode: 0, harap_isi: 'deploy:')
end

puts gagal.zero? ? "\nSEMUA LULUS" : "\n#{gagal} GAGAL"
exit(gagal.zero? ? 0 : 1)
