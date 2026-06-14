import js from "@eslint/js"

import tsParser from "@typescript-eslint/parser"
import tsEslintPlugin from "@typescript-eslint/eslint-plugin"
import tsPlugin from "typescript-eslint"
import reactPlugin from "eslint-plugin-react"
import reactHooksPlugin from "eslint-plugin-react-hooks"
import prettierPluginRecommended from "eslint-plugin-prettier/recommended"
import globals from "globals"
import confusingBrowserGlobals from "confusing-browser-globals"
import jestPlugin from "eslint-plugin-jest"

export default [
  js.configs.recommended,
  prettierPluginRecommended,
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
      typescript: tsPlugin,
      "@typescript-eslint": tsEslintPlugin,
      jest: jestPlugin,
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactPlugin.configs["jsx-runtime"].rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", { varsIgnorePattern: "^_", argsIgnorePattern: "^_" }],
      "no-restricted-globals": ["error"].concat(confusingBrowserGlobals),
    },
    languageOptions: {
      parser: tsParser,
      globals: {
        ...globals.node,
        ...globals.browser,
        ...reactPlugin.configs.recommended.globals,
        ...globals.jest,
        NodeJS: "readonly",
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  {
    files: [
      "src/app/Marine2/components/views/AlarmView.tsx",
      "src/app/Marine2/components/views/BoatOverviewView.tsx",
      "src/app/Marine2/components/views/DigitalSwitchingView.tsx",
      "src/app/Marine2/components/views/SystemOverviewView.tsx",
      "src/app/Marine2/components/views/WatermakerView.tsx",
      "src/app/Marine2/components/views/WeatherForecastView.tsx",
      "src/app/Marine2/components/views/WeatherView.tsx",
      "src/app/Marine2/components/views/SplashScreen.tsx",
      "src/app/Marine2/components/ui/Footer/Footer.tsx",
    ],
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
      "no-undef": "off",
      "prettier/prettier": "warn",
    },
  },
]
