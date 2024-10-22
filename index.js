const express = require("express");
const port = 3000;
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const { execSync } = require("child_process");
const multer = require("multer");
const app = express();
const cors = require("cors");

const xml2js = require("xml2js");
// Load and parse the existing RSS feed
function loadRss(filePath) {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, (err, data) => {
      if (err) {
        return reject(err);
      }
      xml2js.parseString(data, (err, result) => {
        if (err) {
          return reject(err);
        }
        resolve(result);
      });
    });
  });
}

// Create a new RSS item
function createNewItem(
  duplicateFilePath,
  series,
  episodeNumber,
  episodeName,
  comment,
  description
) {
  const title = `${series}, Episode ${episodeNumber}: ${episodeName}`;
  const linkizeTitle = `${series} episode ${episodeNumber} ${episodeName}`
    .replace(/ /g, "-")
    .toLowerCase();
  const link = `https://www.truerestoration.org/${linkizeTitle}`;
  const enclosureUrl = path.basename(duplicateFilePath);
  const guid =
    episodeNumber < 10
      ? `00${episodeNumber}`
      : episodeNumber < 100
      ? `0${episodeNumber}`
      : episodeNumber.toString();
  const pubDate = new Date(comment).toUTCString();

  return {
    title: title,
    link: link,
    description: description,
    enclosure: {
      $: {
        url: `https://s3.us-east-1.amazonaws.com/Restoration_Radio/s013/${enclosureUrl}`,
      },
    },
    guid: { _: guid, $: { isPermaLink: "false" } },
    pubDate: pubDate,
  };
}

// Insert the new item at the top of the RSS feed
function insertNewItem(rss, newItem) {
  if (!rss.rss || !rss.rss.channel || !rss.rss.channel[0].item) {
    throw new Error("Invalid RSS format");
  }
  rss.rss.channel[0].item.unshift(newItem);
}

// Save the updated RSS feed
function saveRss(filePath, rss) {
  const builder = new xml2js.Builder();
  const xml = builder.buildObject(rss);
  fs.writeFileSync(filePath, xml);
}

async function updateXML(
  xmlFilePath,
  duplicateFilePath,
  series,
  episodeNumber,
  episodeName,
  comment,
  description
) {
  try {
    const filePath = xmlFilePath; // Replace with the path to your RSS XML file
    const rss = await loadRss(filePath);
    const newItem = createNewItem(
      duplicateFilePath,
      series,
      episodeNumber,
      episodeName,
      comment,
      description
    );
    console.log("newItem", newItem);
    insertNewItem(rss, newItem);
    console.log("rss", rss);
    saveRss(filePath, rss);
    console.log("filePath", filePath);
    console.log("New item added to the RSS feed.");
  } catch (err) {
    console.error(`Error: ${err.message}`);
  }
}

app.use(express.urlencoded({ extended: true }));

const getAllCapitals = (str) => {
  const regex = /[A-Z]/g;
  return str.match(regex);
};

const getDate = (dateArg) => {
  const date = new Date(dateArg);
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}${month}${day}`;
};

// Set the ffmpeg binary path
ffmpeg.setFfmpegPath(ffmpegPath);

// Function to add tags using Kid3 CLI
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // Specify the directory to save uploaded files
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname); // Use the original file name
  },
});
const upload = multer({ storage });
app.use(cors("https://tr-helper-next.vercel.app/"));

// Express route to handle file processing

let globalRecentFile = "";
app.post(
  "/processFile",
  upload.fields([
    { name: "mp3File", maxCount: 1 },
    { name: "xmlFile", maxCount: 1 },
  ]),
  async (req, res) => {
    globalRecentFile = "";
    const { series, artist, episodeName, episodeNumber, comment, description } =
      req.body;
    console.log(req.files);
    const inputFilePath = req.files.mp3File[0].path;
    const xmlFilePath = req.files.xmlFile[0].path;

    if (!inputFilePath) {
      return res.status(400).send("Input file path is required.");
    }

    // Check if input file exists
    if (!fs.existsSync(inputFilePath)) {
      return res.status(404).send("Input file does not exist.");
    }

    // Get the directory and file extension
    const dir = path.dirname(inputFilePath);
    const ext = path.extname(inputFilePath);

    // Process episode name and number
    const processedEpisodeName = episodeName.replace(/'/g, "\\'");
    const descriptionKid3 = `${series}, Episode ${episodeNumber}: ${processedEpisodeName}`;

    const seriesAcronym = getAllCapitals(series).join("");
    const dateAcronym = getDate(comment);
    const getFirstWordNoPrepositions = (str) => {
      // remove prepositions
      const prepositions = ["of", "the", "and", "in", "on", "to", "for"];
      const words = str.split(" ");
      const firstWord = words.find(
        (word) => !prepositions.includes(word.toLowerCase())
      );
      const lettersOnly = firstWord.replace(/[^a-zA-Z]/g, "");
      return lettersOnly;
    };
    const firstWord = getFirstWordNoPrepositions(episodeName);
    const newFileName = `${dateAcronym}_${seriesAcronym}0${episodeNumber}_${firstWord}`;

    const title = `${series}, Episode ${episodeNumber}: ${episodeName}`;

    // Constants for fixed tag values
    const date = new Date(comment).getFullYear();
    const genre = "Podcast";
    const albumArtist = "Restoration Radio";
    const publisher = `The Restoration Radio Network, Copyright ${date}. All Rights Reserved.`;
    const website = "www.truerestoration.org";
    const rating = "255";
    const album = `Season ${date - 2011}`;

    // Rename the original file
    const newFilePath = path.join(dir, newFileName + ext);
    // Create pseudorandom string of 4 letters, 4 numbers, 4 letters, 4 numbers
    const randomString =
      Math.random().toString(36).substring(2, 6) +
      Math.random().toString(10).substring(2, 6) +
      Math.random().toString(36).substring(2, 6) +
      Math.random().toString(10).substring(2, 6);
    fs.renameSync(inputFilePath, newFilePath);
    const duplicateFilePath = path.join(
      dir,
      `${newFileName}-${randomString}${ext}`
    );

    await updateXML(
      xmlFilePath,
      duplicateFilePath,
      series,
      episodeNumber,
      episodeName,
      comment,
      description
    );

    fs.copyFileSync(newFilePath, duplicateFilePath);
    function addTags(filePath) {
      const commands = [
        `kid3-cli -c "set title '${title}'"`,
        `kid3-cli -c "set artist '${artist}'"`,
        `kid3-cli -c "set album '${album}'"`,
        `kid3-cli -c "set comment '${comment}'"`,
        `kid3-cli -c "set description '${descriptionKid3}'"`,
        `kid3-cli -c "set date '${date}'"`,
        `kid3-cli -c "set genre '${genre}'"`,
        `kid3-cli -c "set albumartist '${albumArtist}' "`,
        `kid3-cli -c "set publisher '${publisher}'"`,
        `kid3-cli -c "set URL '${website}'"`,
        `kid3-cli -c "set rating '${rating}'"`,
        `kid3-cli  -c "set picture:'TR_Icon.png' 'TR Logo'"`, // Add image at path TR_Icon.png
      ];
      commands.forEach((command) => {
        console.log(`${command} ${filePath}`);
        execSync(`${command} ${filePath}`);
        console.log(`Tag added  ${command}`);
      });
    }

    // Create the output file with a fadeout
    const previewFilePath = path.join(dir, `${newFileName}_Preview${ext}`);

    ffmpeg(newFilePath)
      .duration(300) // 300 seconds = 5 minutes
      .audioFilters("afade=t=out:st=255:d=45") // Fade out from 4:15 (255 seconds) over 45 seconds
      .on("end", () => {
        console.log(
          `File has been renamed to ${newFilePath} and new file created at ${previewFilePath}`
        );
        // Add tags to the new file
        setTimeout(() => {
          addTags(previewFilePath);
          addTags(newFilePath);
          globalRecentFile = newFilePath;
        }, 5000);
      })
      .on("error", (err) => {
        console.error(`Error: ${err.message}`);
        res.status(500).send(`Error processing file: ${err.message}`);
      })
      .save(previewFilePath);
    setTimeout(() => {
      globalRecentFile = "";
      fs.readdir(dir, (err, files) => {
        if (err) {
          console.error(`Error: ${err.message}`);
        } else {
          files.forEach((file) => {
            fs.unlinkSync(path.join(dir, file));
          });
        }
      });
    }, 1800000); // 30 minutes in milliseconds

    res.json({
      message: "File processed successfully",
      newFilePath,
      previewFilePath,
      duplicateFilePath,
    });
  }
);

app.get("/download", (req, res) => {
  const filePath = req.query.filePath;
  console.log("filePath", filePath);
  res.download(filePath);
});
app.get("/checkfile", (req, res) => {
  const fileName = req.query.fileName;
  console.log("fileName", fileName);
  console.log("globalRecentFile", globalRecentFile);
  if (globalRecentFile === fileName) {
    res.json({ message: "File matches" });
  } else {
    res.json({ message: "File does not match" });
  }
});

app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
