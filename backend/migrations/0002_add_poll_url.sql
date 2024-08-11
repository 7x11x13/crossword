-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Crossword" (
    "publishedDate" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "author" TEXT NOT NULL,
    "editor" TEXT NOT NULL,
    "dateString" TEXT NOT NULL,
    "dayName" TEXT NOT NULL,
    "pollExists" BOOLEAN NOT NULL,
    "pollURL" TEXT,
    "excellent" INTEGER,
    "good" INTEGER,
    "average" INTEGER,
    "poor" INTEGER,
    "terrible" INTEGER,
    "noVote" INTEGER,
    "votes" INTEGER,
    "excellentPercentage" REAL,
    "goodPercentage" REAL,
    "averagePercentage" REAL,
    "poorPercentage" REAL,
    "terriblePercentage" REAL,
    "averageRating" REAL
);
INSERT INTO "new_Crossword" ("author", "average", "averagePercentage", "averageRating", "dateString", "dayName", "editor", "excellent", "excellentPercentage", "good", "goodPercentage", "noVote", "pollExists", "poor", "poorPercentage", "publishedDate", "terrible", "terriblePercentage", "votes") SELECT "author", "average", "averagePercentage", "averageRating", "dateString", "dayName", "editor", "excellent", "excellentPercentage", "good", "goodPercentage", "noVote", "pollExists", "poor", "poorPercentage", "publishedDate", "terrible", "terriblePercentage", "votes" FROM "Crossword";
DROP TABLE "Crossword";
ALTER TABLE "new_Crossword" RENAME TO "Crossword";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
