# RDS Electronics CRM

A small, simple CRM and invoicing app for an electronics repair shop. It tracks
customers, repair jobs and invoices, and runs on one computer with no outside
services required.

## What it does

- **Customers**: add, edit and search (name, phone or email). Each customer
  page lists all of their repair jobs and invoices.
- **Repair jobs**: customer, device type, brand/model, serial number, problem
  and date received. Jobs move through
  Received → Diagnosing → Waiting for Parts → Repairing → Ready for Pickup → Picked Up.
  Each job has dated notes and a status history. View open jobs as a
  drag-and-drop board or a list, filtered by status.
- **Invoices**: one click from a job creates an invoice with the customer and
  device filled in. Add parts and labor lines; subtotal, discount, tax and total
  are worked out for you. Invoices are numbered automatically, can be printed,
  downloaded as a PDF with your logo and business details, or emailed to the
  customer. Record cash, card or other payments; the status follows along as
  Draft, Sent, Overdue or Paid.
- **Dashboard**: open jobs by status, jobs ready for pickup, unpaid invoices
  and money collected this month.
- **One shared password** for you and your staff. No user accounts or roles.

## Getting started

You need [Node.js](https://nodejs.org) version 22.13 or newer.

```bash
npm install
```

```bash
npm start
```

Then open <http://localhost:3000> in your browser.

1. The first time, you are asked to choose the shop password.
2. Go to **Settings** and add your address, phone, logo and tax rate. These
   appear on your invoices.
3. Press **New job** when a customer drops off a device.

Other computers, tablets and phones on the same network can use the app at
`http://<this-computer's-IP-address>:3000`.

### Try it with sample data

To see how everything looks before entering real data, load some made-up
customers, jobs and invoices. This only works on an empty database.

```bash
npm run seed
```

To start again from scratch, stop the app and delete the `data` folder.

## Your data and backups

Everything is stored in a single file, `data/rds.db`.

- **Back up**: Settings → Backup → *Download backup*. Do this regularly and keep
  the file somewhere safe. It contains all of your data, so treat it as private.
- **Restore**: stop the app, replace `data/rds.db` with your backup file, delete
  `data/rds.db-wal` and `data/rds.db-shm` if they exist, and start the app again.

## Emailing invoices

Invoices are sent through your own email account. In Settings → Email, enter the
details from your email provider (they call them "SMTP settings"), then press
*Send a test email*.

For Gmail: mail server `smtp.gmail.com`, port `465`, username is your Gmail
address, and the password is an *app password* created in your Google account
(Security → 2-Step Verification must be switched on first).

Until email is set up, the Email button offers the PDF download and opens your
own email app with the message already written.

## Forgot the password?

Stop the app, then run:

```bash
npm run reset-password
```

Start the app again and it will ask you to choose a new password. No data is lost.

## Options

Set these environment variables before `npm start` if you need them:

| Variable        | Default       | What it does                                                        |
| --------------- | ------------- | ------------------------------------------------------------------- |
| `PORT`          | `3000`        | Port the app listens on.                                            |
| `HOST`          | `0.0.0.0`     | Use `127.0.0.1` to allow this computer only.                        |
| `DATABASE_FILE` | `data/rds.db` | Where the data file lives.                                          |
| `TRUST_PROXY`   | off           | Set to `1` when running behind a reverse proxy or hosting platform. |

### Using it over the internet

On your shop network the app works as it is. If you want to reach it from
outside the shop, put it behind HTTPS (a hosting platform, or a reverse proxy
such as Caddy or nginx), set `TRUST_PROXY=1`, make sure the `data` folder is on
storage that is kept between restarts, and choose a long password.

## For developers

- Node.js + Express, server-rendered EJS pages, a little plain JavaScript in
  `public/js`. No build step.
- SQLite through Node's built-in `node:sqlite`. The schema is in `src/db.js`;
  add a new entry to `MIGRATIONS` to change it.
- Money is stored as whole cents. Invoice maths lives in `src/money.js` and is
  mirrored in `public/js/invoice-form.js` for the live totals.
- PDFs are drawn with PDFKit in `src/pdf.js`; email goes through Nodemailer in
  `src/mailer.js`.

```bash
npm test
```

```
server.js            starts the app
src/app.js           app setup: security headers, sessions, routes
src/routes/          dashboard, customers, jobs, invoices, settings
src/invoice-model.js invoice numbers, totals, payments and statuses
views/               page templates
public/              stylesheet and browser scripts
scripts/             demo data and password reset
test/                automated tests
```

The bundled Inter font (`assets/fonts`) is used in PDFs and is licensed under
the SIL Open Font License; see `assets/fonts/OFL.txt`.
