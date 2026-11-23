# Panduan setup Arsip Sekolah

Ikuti urutan ini untuk menyiapkan GitHub Pages sebagai frontend dan Google Apps Script sebagai backend. Arsip dan daftar izin disimpan di Google Sheets; file disimpan di Google Drive. Frontend tidak memakai `localStorage` sebagai database.

## Yang perlu disiapkan

- Akun Google pemilik sekolah yang akan menjadi **pemilik backend dan Drive**.
- Email Google pemilik dan email pengguna yang perlu membuka berkas Drive.
- Satu akun email khusus di Firebase Authentication untuk identitas internal login bersama. Pengguna aplikasi tetap masuk memakai username, bukan email ini.
- Akun GitHub untuk menerbitkan frontend.
- Akses ke Firebase Console.

## Langkah 1 — Terbitkan frontend di GitHub Pages

1. Buat repository baru di GitHub.
2. Unggah `index.html` ke root repository. README boleh ikut diunggah; folder `gas-backend` adalah sumber backend untuk disalin pada langkah berikutnya.
3. Buka **Settings → Pages** pada repository.
4. Pada **Build and deployment**, pilih **Deploy from a branch**, branch `main`, folder `/ (root)`, lalu **Save**.
5. Tunggu sampai GitHub Pages aktif. URL situs untuk project ini adalah `https://wahyuwrdn110-cpu.github.io/ARSIP-SEKOLAH/`.
6. Origin yang dipakai untuk project ini adalah `https://wahyuwrdn110-cpu.github.io` — **tanpa** `/ARSIP-SEKOLAH/`. Gunakan origin ini pada Script Property `ALLOWED_ORIGINS`.

Login baru berfungsi setelah Firebase Auth, Script Properties, dan frontend dikonfigurasi.

## Langkah 2 — Siapkan login Firebase

1. Buka Firebase Console untuk project `arsip-sekolah-7f36d`.
2. Pada **Authentication → Sign-in method**, aktifkan provider **Email/Password**.
3. Pada **Authentication → Users**, buat satu user bersama dengan email Firebase yang berbeda dari `ADMIN_EMAIL`. Gunakan inbox pemulihan yang dikuasai pemilik. Email ini hanya dipakai internal untuk autentikasi/pemulihan; pengguna aplikasi memasukkan username dan password.
4. Gunakan password awal yang kuat. Jangan masukkan password ke source code, README, atau Script Properties.
5. Pastikan Realtime Database Rules mengizinkan user login ini membaca dan menulis data arsip. Jika rules membatasi UID lama, sesuaikan dengan UID user bersama baru tanpa membuka akses publik.

Email internal Firebase tetap diperlukan karena Firebase Email/Password menggunakan email sebagai ID akun. Username singkat dipetakan ke akun ini oleh backend.

## Langkah 3 — Buat dan siapkan Google Apps Script

1. Masuk ke [Google Apps Script](https://script.google.com/) dengan akun Google pemilik backend/Drive, lalu buat project **Standalone**.
2. Buka `gas-backend/Code.gs` di repository ini. Salin seluruh isinya ke file `Code.gs` pada Apps Script.
3. Di Apps Script, buka **Project Settings**, aktifkan opsi untuk menampilkan file manifest `appsscript.json` di editor. Buka file manifest tersebut, ganti isinya dengan `gas-backend/appsscript.json`, lalu simpan.
4. Buka **Project Settings → Script Properties**, tambahkan properti berikut:

   | Property | Isi |
   | --- | --- |
   | `ADMIN_EMAIL` | Email Google pemilik backend dan folder Drive |
   | `AUTHORIZED_EMAILS` | Email Google pengguna yang perlu membuka berkas Drive, dipisah koma |
   | `LOGIN_EMAIL` | Email user Firebase bersama dari langkah 2; harus berbeda dari `ADMIN_EMAIL` dan inbox-nya dikuasai pemilik |
   | `LOGIN_USERNAME` | Username awal, 3–32 karakter: huruf, angka, titik, garis bawah, atau tanda hubung |
   | `FIREBASE_API_KEY` | `apiKey` dari `firebaseConfig` di `index.html`; dipakai backend untuk memvalidasi Firebase ID token |
   | `ALLOWED_ORIGINS` | `https://wahyuwrdn110-cpu.github.io` |

   `ALLOWED_ORIGINS` harus berupa origin `https://` yang tepat, **tanpa path**. Untuk beberapa situs, pisahkan origin dengan koma. `AUTHORIZED_EMAILS` adalah izin viewer Google Drive, bukan akun login aplikasi. `FIREBASE_API_KEY` bukan password atau Client Secret, tetapi tetap batasi penggunaan API key sesuai kebutuhan project.
5. Di editor Apps Script, pilih fungsi `initializeDatabase` dari daftar fungsi, lalu tekan **Run**.
6. Tinjau dan setujui izin yang diminta Google. Bila ada pesan bahwa aplikasi belum diverifikasi, ikuti alur izin akun Anda sendiri untuk menjalankan project milik sendiri.
7. Setelah berhasil, fungsi membuat folder Drive `Arsip Sekolah` dan spreadsheet `Data Arsip Sekolah` dengan tab `Arsip` dan `Pengguna`. Jangan hapus Script Properties yang dibuat/diisi; ID spreadsheet dan folder disimpan di sana.

Jalankan `initializeDatabase` hanya saat setup awal. Jika database sudah pernah dibuat, jangan jalankan ulang; cukup tambahkan Script Properties login yang belum ada. Jika gagal, baca pesan error dan perbaiki Script Properties atau header sheet sebelum mencoba lagi.

## Langkah 4 — Deploy backend sebagai Web App

1. Di Apps Script, pilih **Deploy → New deployment**.
2. Pilih jenis **Web app**.
3. Atur **Execute as** menjadi **Me** (akun pemilik backend). Ini memastikan semua pengguna menggunakan penyimpanan Drive dan Sheets pusat milik sekolah.
4. Pada **Who has access**, pilih **Anyone** bila kebijakan akun mengizinkan. Backend memeriksa Firebase ID token pada setiap operasi dan hanya menerima user Firebase bersama yang ditetapkan. Jika organisasi melarang akses tersebut, minta administrator Workspace meninjau kebijakan sebelum melanjutkan.
5. Tekan **Deploy**, selesaikan otorisasi jika diminta, lalu salin URL Web App yang berakhiran `/exec`.

Jangan pilih **Execute as: User accessing the web app** untuk skema penyimpanan bersama ini. Jangan membagikan spreadsheet atau project Apps Script kepada guru.

## Langkah 5 — Hubungkan frontend ke backend

1. Buka `index.html` di repository lokal.
2. Pastikan `apiUrl` menunjuk ke URL Web App `/exec` terbaru dan `firebaseConfig` menunjuk ke project Firebase yang sama dengan user login bersama.
3. Simpan, lalu unggah/commit perubahan `index.html` ke branch `main` di GitHub. Jika memakai Firebase Hosting, perbarui juga `public/index.html`.
4. Tunggu hosting selesai menerbitkan perubahan, kemudian buka URL situs dan muat ulang halaman.

Tidak ada password login yang dimasukkan ke `index.html`. Jangan memasukkan password, token, Spreadsheet ID, atau Folder ID ke frontend.

## Langkah 6 — Uji login dan penyimpanan

1. Buka URL GitHub Pages dan masuk dengan username/password bersama yang sesuai dengan akun Firebase pada `LOGIN_EMAIL`.
2. Buka **Pengaturan**. Pastikan status database dan Drive terhubung.
3. Tambahkan email Google setiap pengguna yang perlu membuka lampiran ke daftar akses Drive. Mereka tetap harus login ke Google saat membuka lampiran.
4. Tambahkan arsip uji dengan kategori, nama, tanggal, deskripsi, dan bila perlu progres pembangunan. Unggah satu JPG/PNG atau PDF kecil.
5. Periksa hasilnya:
   - Tab `Arsip` di spreadsheet berisi metadata dan ID/tautan berkas.
   - Drive berisi `Arsip Sekolah/<tahun>/<kategori>/`.
   - Arsip dapat ditemukan dengan pencarian/filter dan file dapat dibuka/diunduh.
   - Setelah keluar lalu masuk kembali, arsip masih tersedia.
6. Uji username atau password salah. Backend harus menolak token yang tidak berasal dari user Firebase bersama.

## Pemakaian dan perubahan kode

- Akun bersama memiliki hak admin penuh. Semua pemegang username/password dapat membaca, menambah, mengubah, menghapus arsip, mengubah username/password bersama, dan mengelola akses Google Drive.
- Seluruh aktivitas tercatat menggunakan username bersama; aplikasi tidak dapat membedakan pengguna perorangan.
- Pemilik dapat mengatur ulang password dari Firebase Console. Pemegang password bersama juga dapat mengubah password dari menu Pengaturan; ini konsekuensi dari model login bersama Firebase standar.
- Username/password bekerja lintas perangkat setelah membuka URL yang sama. Sesi login tersimpan pada perangkat masing-masing.
- Email Google pemilik tetap menjadi pemilik Apps Script dan Drive, bukan username login harian.
- Untuk membuka lampiran, setiap pengguna harus login ke akun Google yang sudah diberi akses viewer pada folder Drive.
- Maksimal 10 file dan total 10 MB per arsip. Tipe yang diterima: JPEG, PNG, GIF, WebP, dan PDF; server juga memeriksa signature file.
- Penghapusan arsip menghapus baris metadata dan memindahkan file terkait ke sampah Drive.
- Frontend mengambil ulang data berkala dan menyediakan tombol **Perbarui data**.
- Setelah mengubah kode Apps Script, buka **Deploy → Manage deployments → Edit**, pilih **New version**, lalu deploy. URL `/exec` biasanya tetap sama. Jika URL berubah, perbarui `apiUrl` di `index.html` dan unggah lagi ke GitHub.
- Jika origin Pages berubah, ubah `ALLOWED_ORIGINS` di Script Properties.

## Jika terjadi masalah

- **Konfigurasi belum lengkap**: periksa nilai `window.ARSIP_CONFIG` di `index.html`.
- **Backend tidak merespons**: pastikan URL `/exec` benar, Web App sudah di-deploy, `ALLOWED_ORIGINS` sama persis dengan origin Pages, dan deployment memakai versi kode terbaru.
- **Username/password ditolak**: pastikan Email/Password aktif di Firebase Authentication, user `LOGIN_EMAIL` sudah dibuat pada project yang benar, dan username cocok dengan `LOGIN_USERNAME`.
- **Token Firebase ditolak**: pastikan `FIREBASE_API_KEY` sama dengan API key project Firebase dan `LOGIN_EMAIL` sama persis dengan email user Firebase bersama.
- **Status Sheets/Drive gagal**: periksa Script Properties `ARCHIVE_SHEET_ID` dan `ARCHIVE_FOLDER_ID`, lalu akses/izin project dengan akun pemilik.
- **File Drive tidak bisa dibuka**: pastikan alamat email pengguna diizinkan dan kebijakan Google Workspace mengizinkan berbagi folder kepada email tersebut.

Login Firebase, aturan Realtime Database, kebijakan Workspace, dan deployment cloud harus diuji pada project milik sekolah; pemeriksaan lokal repository tidak dapat menggantikan uji deployment tersebut.
