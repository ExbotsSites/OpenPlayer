import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended, // Attiva le regole base consigliate da ESLint
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,     // Riconosce le variabili globali di Node.js (require, process, ecc.)
        ...globals.browser,  // Riconosce le variabili globali del browser (window, document, ecc.)
      },
    },
    rules: {
      // Qui puoi aggiungere o personalizzare le tue regole se necessario
      "no-unused-vars": "warn", // Segnala le variabili inutilizzate come avviso invece che errore
    },
  },
];
