/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ["./public/**/*.{html,js}"],
    theme: {
        extend: {
            colors: {
                brand: {
                    green: '#2A5934',
                    red: '#B82928',
                    redlight: '#FCE7E7',
                    blue: '#1D4ED8',
                    bluelight: '#DBEAFE',
                    gold: '#C5A063',
                    bright: '#F5F4F0',
                }
            }
        },
    },
    plugins: [],
}
