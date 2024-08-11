import { useMemo, useState } from "react";
import {
	Anchor,
	Center,
	Container,
	Flex,
	Loader,
	Space,
	Text,
	Title,
} from "@mantine/core";
import axios from "axios";
import {
	MantineReactTable,
	useMantineReactTable,
	type MRT_ColumnDef,
	type MRT_Cell,
} from "mantine-react-table";

interface Poll {
	publishedDate: number;
	author: string;
	editor: string;
	dateString: string;
	dayName: string;
	pollExists: boolean;
	pollURL: string;
	excellent: number;
	good: number;
	average: number;
	poor: number;
	terrible: number;
	noVote: number;
	votes: number;
	excellentPercentage: number;
	goodPercentage: number;
	averagePercentage: number;
	poorPercentage: number;
	terriblePercentage: number;
	averageRating: number;
}

function intToDate(x: number) {
	// convert UTC timestamped date to local date with same year, month, day
	const UTC = new Date(x);
	return new Date(UTC.getUTCFullYear(), UTC.getUTCMonth(), UTC.getUTCDate());
}

function floatCell(precision: number) {
	return ({ cell }: { cell: MRT_Cell<Poll, unknown> }) => (
		<span>{cell.getValue<number>().toFixed(precision)}</span>
	);
}

function percentageCell(precision: number) {
	return ({ cell }: { cell: MRT_Cell<Poll, unknown> }) => (
		<span>{cell.getValue<number>().toFixed(precision)}%</span>
	);
}

function App() {
	const [pollData, setPollData] = useState<Poll[]>([]);

	const columns = useMemo<MRT_ColumnDef<Poll>[]>(
		() => [
			{
				accessorKey: "publishedDate",
				header: "Date",
				filterVariant: "date-range",
				filterFn: (row, _, [start, end]: [Date?, Date?]) => {
					const rowDate = intToDate(row.original.publishedDate);
					let between = true;
					if (start !== undefined) {
						between &&= rowDate >= start;
					}
					if (end !== undefined) {
						between &&= rowDate <= end;
					}
					return between;
				},
				Cell: ({ cell }: { cell: MRT_Cell<Poll, unknown> }) => (
					<Anchor href={cell.row.original.pollURL} target="_blank">{cell.row.original.dateString}</Anchor>
				),
			},
			{
				accessorKey: "dayName",
				header: "Day",
			},
			{
				accessorKey: "author",
				header: "Author",
			},
			{
				accessorKey: "editor",
				header: "Editor",
			},
			{
				accessorKey: "averageRating",
				header: "Rating",
				Cell: floatCell(3),
				filterVariant: "range",
			},
			{
				accessorKey: "votes",
				header: "Votes",
				filterVariant: "range",
			},
			{
				accessorKey: "excellentPercentage",
				header: "Excellent",
				Cell: percentageCell(1),
				filterVariant: "range",
			},
			{
				accessorKey: "goodPercentage",
				header: "Good",
				Cell: percentageCell(1),
				filterVariant: "range",
			},
			{
				accessorKey: "averagePercentage",
				header: "Average",
				Cell: percentageCell(1),
				filterVariant: "range",
			},
			{
				accessorKey: "poorPercentage",
				header: "Poor",
				Cell: percentageCell(1),
				filterVariant: "range",
			},
			{
				accessorKey: "terriblePercentage",
				header: "Terrible",
				Cell: percentageCell(1),
				filterVariant: "range",
			},
		],
		[],
	);

	const table = useMantineReactTable<Poll>({
		columns,
		data: pollData,
		enableRowVirtualization: true,
		rowVirtualizerOptions: { overscan: 10 },
		enablePagination: false,
		mantineTableContainerProps: {
			style: { maxHeight: "50vh" },
		},
		enableBottomToolbar: false,
		initialState: {
			showColumnFilters: true,
			density: "xs",
			sorting: [{ id: "publishedDate", desc: true }],
		},
		enableRowNumbers: true,
		enableColumnResizing: true,
		enableColumnOrdering: true,
		enableFilterMatchHighlighting: false,
	});

	async function loadPollData() {
		const url = import.meta.env.VITE_BACKEND_URL;
		const data: Poll[] = (await axios.get(url)).data;
		setPollData(data.filter((poll: Poll) => poll.pollExists));
	}

	if (pollData.length === 0) {
		loadPollData();
	}

	return (
		<Container size="xl" ta="center">
			<Flex direction="column" gap="sm">
				<Title>
					<Anchor
						inherit
						inline
						href="https://www.reddit.com/r/crossword/"
						target="_blank"
					>
						r/crossword
					</Anchor>{" "}
					poll archive
				</Title>
				<Text>
					Made by{" "}
					<Anchor inherit inline href="https://7x11x13.xyz/" target="_blank">
						7x11x13
					</Anchor>
				</Text>
				<Space />
				<Center>
					{pollData.length > 0 ? (
						<MantineReactTable table={table} />
					) : (
						<Loader></Loader>
					)}
				</Center>
			</Flex>
		</Container>
	);
}

export default App;
