"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEMO_PRODUCT_CATALOGUES = void 0;
exports.getDemoCategories = getDemoCategories;
exports.DEMO_PRODUCT_CATALOGUES = {
    'tenant-a': [
        {
            id: 'prod-a-001',
            name: 'ZenRun Running Shoes',
            category: 'sports',
            price: 79.99,
            summary: 'Lightweight cushioned running shoes for daily training.',
            stock: 42,
        },
        {
            id: 'prod-a-002',
            name: 'ZenFlex Yoga Mat',
            category: 'sports',
            price: 24.5,
            summary: 'Non-slip 6mm yoga mat with alignment lines.',
            stock: 0,
        },
        {
            id: 'prod-a-003',
            name: 'ZenBrew Coffee Maker',
            category: 'appliances',
            price: 89.9,
            summary: '12-cup drip coffee maker with programmable timer.',
            stock: 15,
        },
        {
            id: 'prod-a-004',
            name: 'ZenSound Wireless Earbuds',
            category: 'electronics',
            price: 49.99,
            summary: 'Bluetooth 5.3 earbuds with 24h battery life.',
            stock: 100,
        },
        {
            id: 'prod-a-005',
            name: 'ZenGlow Desk Lamp',
            category: 'home',
            price: 35,
            summary: 'LED desk lamp with 5 colour temperatures and USB port.',
            stock: 8,
        },
    ],
    'tenant-b': [
        {
            id: 'prod-b-001',
            name: 'ZenAcademy Science Textbook',
            category: 'books',
            price: 32.5,
            summary: 'Grade 8 integrated science textbook, 2026 edition.',
            stock: 120,
        },
        {
            id: 'prod-b-002',
            name: 'ZenAcademy Geometry Set',
            category: 'stationery',
            price: 9.99,
            summary: 'Metal compass, protractor and ruler set in a tin case.',
            stock: 75,
        },
        {
            id: 'prod-b-003',
            name: 'ZenAcademy School Uniform',
            category: 'uniforms',
            price: 27,
            summary: 'Official school uniform, sizes 6 to 16.',
            stock: 40,
        },
        {
            id: 'prod-b-004',
            name: 'ZenAcademy Art Kit',
            category: 'stationery',
            price: 18.75,
            summary: '24-piece art kit with watercolours, brushes and sketchpad.',
            stock: 0,
        },
    ],
};
function getDemoCategories(tenantId) {
    const catalogue = exports.DEMO_PRODUCT_CATALOGUES[tenantId] ?? [];
    return [...new Set(catalogue.map((product) => product.category))];
}
//# sourceMappingURL=demo-catalogues.js.map