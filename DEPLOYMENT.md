# Local Deployment Guide: IntelliExtract Pro

Follow these steps to set up and test the application on your local machine.

## 1. Prerequisites
- **Node.js**: Ensure you have Node.js (v18 or later) installed.
- **Google AI API Key**: Obtain a key from the [Google AI Studio](https://aistudio.google.com/).
- **Code Editor**: VS Code is recommended.

## 2. Project Setup
Create a new directory for your project and initialize it:

```bash
mkdir intelli-extract-pro
cd intelli-extract-pro
npm init -y
```

## 3. Install Development Dependencies
We use **Vite** as the build tool because it natively supports the ESM structure and TypeScript files used in this project.

```bash
npm install -D vite typescript @types/react @types/react-dom
```

## 4. File Structure
Ensure your directory looks like this (copy the provided code into these files):
- `index.html`
- `index.tsx`
- `App.tsx`
- `types.ts`
- `constants.tsx`
- `sampleModels.ts`
- `services/geminiService.ts`
- `components/Sidebar.tsx`
- `components/DataModelView.tsx`
- `components/TransformationPipeline.tsx`
- `components/DatabaseConnectionModal.tsx`
- `components/ImportModelModal.tsx`
- `components/ExtractionPreview.tsx`

## 5. Configure API Key
The application expects the API key in `process.env.API_KEY`. When using Vite, you can provide this via a `.env` file.

1. Create a file named `.env` in the root directory.
2. Add your key:
   ```env
   VITE_GEMINI_API_KEY=your_actual_api_key_here
   ```

*Note: In the provided source code, change `process.env.API_KEY` to `import.meta.env.VITE_GEMINI_API_KEY` if you are using Vite, or ensure your build tool injects the environment variable correctly.*

## 6. Development Server
Run the local development server:

```bash
npx vite
```

The terminal will provide a URL (usually `http://localhost:5173`). Open this in your browser.

## 7. Testing Dialect-Agnostic Features
To verify the **PostgreSQL** vs **Oracle** functionality:

1. **Importing**:
   - Click **"Import Model"**.
   - Select the **"Oracle ATP/DBCS"** toggle.
   - Click on the **"E-commerce (SQL)"** sample.
   - Verify that the badge in the header shows "Oracle ATP/DBCS".
2. **SQL Generation**:
   - Create a new Extraction Specification at the bottom of the page.
   - Click **"Preview"**.
   - Verify that the generated SQL uses Oracle-specific syntax (e.g., specific quoting or dual tables if applicable).
3. **Switching Context**:
   - Select the **"Purchase Order Hub"** from the sidebar (Postgres mock).
   - Generate a preview and note the syntax differences compared to the Oracle model.

## 8. Troubleshooting
- **401 Unauthorized**: Ensure your API key in the `.env` file is valid and has no trailing spaces.
- **Module Not Found**: Ensure the `importmap` in `index.html` matches the imports used in the TSX files.
- **SQL Generation Failed**: Check the browser console; the Gemini API might be returning a safety filter block if the prompt contains certain keywords.