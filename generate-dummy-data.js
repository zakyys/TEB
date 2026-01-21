// Generate dummy transactions for the last 7 days
// Copy paste this code into browser console (F12)

function generateDummyTransactions() {
    const products = [
        { id: 'p1', name: 'Baut M8', price: 5000, sku: 'B-M8' },
        { id: 'p2', name: 'Mur M8', price: 3000, sku: 'M-M8' },
        { id: 'p3', name: 'Ring M10', price: 2000, sku: 'R-M10' },
        { id: 'p4', name: 'Baut M10', price: 7000, sku: 'B-M10' },
        { id: 'p5', name: 'Sekrup 4x40', price: 1500, sku: 'S-440' },
        { id: 'p6', name: 'Fischer 6mm', price: 4000, sku: 'F-6' },
        { id: 'p7', name: 'Paku 3 inch', price: 25000, sku: 'P-3' },
        { id: 'p8', name: 'Engsel Pintu', price: 35000, sku: 'E-P' },
    ];

    const transactions = [];
    const now = new Date();

    // Generate transactions for last 7 days
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        const date = new Date(now);
        date.setDate(date.getDate() - dayOffset);

        // 3-8 transactions per day
        const numTransactions = Math.floor(Math.random() * 6) + 3;

        for (let i = 0; i < numTransactions; i++) {
            // Random time of day
            const hour = Math.floor(Math.random() * 12) + 8; // 8 AM - 8 PM
            const minute = Math.floor(Math.random() * 60);

            date.setHours(hour, minute, 0, 0);

            // Random number of items (1-4 different products)
            const numItems = Math.floor(Math.random() * 4) + 1;
            const items = [];

            for (let j = 0; j < numItems; j++) {
                const product = products[Math.floor(Math.random() * products.length)];
                const quantity = Math.floor(Math.random() * 5) + 1; // 1-5 quantity

                items.push({
                    id: product.id,
                    name: product.name,
                    price: product.price,
                    quantity: quantity,
                    sku: product.sku,
                    type: 'product'
                });
            }

            const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            const tax = 0; // No PPN
            const total = subtotal + tax;

            transactions.push({
                id: `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                date: date.toISOString(),
                items: items,
                customer: null,
                subtotal: subtotal,
                tax: tax,
                total: total,
                amountPaid: total,
                change: 0,
                paymentMethod: 'cash'
            });
        }
    }

    return transactions;
}

// Run this function
console.log('Generating dummy transactions...');
const dummyTransactions = generateDummyTransactions();
console.log(`Generated ${dummyTransactions.length} transactions`);

// Get existing transactions
const existingTransactions = JSON.parse(localStorage.getItem('pos_transactions') || '[]');

// Merge with existing
const allTransactions = [...existingTransactions, ...dummyTransactions];

// Save to localStorage
localStorage.setItem('pos_transactions', JSON.stringify(allTransactions));

console.log(`✅ Done! Total transactions in storage: ${allTransactions.length}`);
console.log('Refresh the page to see the data!');
