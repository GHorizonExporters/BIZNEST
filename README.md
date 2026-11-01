# BIZNEST ERP — Business, in Balance.

## Get BIZNEST-Setup.exe (pick one)
**A. On any Windows PC** (install Node.js 20 LTS from nodejs.org first):
    npm install
    npm run dist
Installer appears in `dist\BIZNEST-Setup.exe`. Double-click it on any Windows PC.

**B. No tools needed:** push this folder to a GitHub repo -> Actions tab -> "Build BIZNEST installer" -> download the artifact.

**Test without installing:** `npm install` then `npm start`.

## Data
Stored in `%APPDATA%\BIZNEST\Data` (biznest.db, Backups\). Installer/uninstaller never delete it.
First launch asks for business name + owner account.

## Modules
Dashboard · POS (barcode scan, discounts, GST, split pay, A4/thermal print) · Sales Returns · Products (images, bulk CSV import/export, barcode labels) · Categories · Suppliers (outstanding + payments) · Purchases · Customers (credit + payments) · Expenses · 9 Reports (CSV/Excel, print/PDF) · Users & roles · Business settings · Backup/Restore · Device registry.

## Bulk import columns (CSV header row)
sku, barcode, name, category, purchase_price, sell_price, wholesale_price, gst, stock, min_stock
(Existing SKUs are updated; new ones are created; categories are auto-created.)

## Roles
owner/admin: everything · manager: dashboard, POS, returns, customers, reports · cashier: POS, returns, customers · inventory: products, categories, suppliers, purchases · accountant: dashboard, reports, expenses
