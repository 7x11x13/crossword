import React from "react";
import ReactDOM from "react-dom/client";
import { createTheme, MantineProvider } from "@mantine/core";
import App from "./App.tsx";
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "mantine-react-table/styles.css";

const theme = createTheme({
	colors: {
		orangered: [
			"#ffede4",
			"#ffdbcd",
			"#ffb69b",
			"#ff8e64",
			"#fe6d37",
			"#fe571a",
			"#ff4c09",
			"#e43c00",
			"#cb3400",
			"#b12900",
		],
	},
	primaryColor: "orangered",
});

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<MantineProvider theme={theme} defaultColorScheme="auto">
			<App />
		</MantineProvider>
	</React.StrictMode>,
);
