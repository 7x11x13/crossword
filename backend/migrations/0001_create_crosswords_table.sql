-- CreateTable
CREATE TABLE "Crossword" (
    "publishedDate" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "author" TEXT NOT NULL,
    "editor" TEXT NOT NULL,
    "dateString" TEXT NOT NULL,
    "dayName" TEXT NOT NULL,
    "pollExists" BOOLEAN NOT NULL,
    "excellent" INTEGER NOT NULL DEFAULT 0,
    "good" INTEGER NOT NULL DEFAULT 0,
    "average" INTEGER NOT NULL DEFAULT 0,
    "poor" INTEGER NOT NULL DEFAULT 0,
    "terrible" INTEGER NOT NULL DEFAULT 0,
    "noVote" INTEGER NOT NULL DEFAULT 0,
    "votes" INTEGER NOT NULL DEFAULT 0,
    "excellentPercentage" REAL NOT NULL DEFAULT 0,
    "goodPercentage" REAL NOT NULL DEFAULT 0,
    "averagePercentage" REAL NOT NULL DEFAULT 0,
    "poorPercentage" REAL NOT NULL DEFAULT 0,
    "terriblePercentage" REAL NOT NULL DEFAULT 0,
    "averageRating" REAL NOT NULL DEFAULT 0
);
