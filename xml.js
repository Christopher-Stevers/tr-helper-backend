const fs = require("fs");
const xml2js = require("xml2js");
const readlineSync = require("readline-sync");

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
function createNewItem() {
  const title = readlineSync.question("Enter the title: ");
  const link = readlineSync.question("Enter the link: ");
  const description = readlineSync.question("Enter the description: ");
  const enclosureUrl = readlineSync.question("Enter the enclosure URL: ");
  const guid = readlineSync.question("Enter the GUID: ");
  const pubDate = new Date().toUTCString();

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

(async function () {
  try {
    const filePath = "./annualaccess.xml"; // Replace with the path to your RSS XML file
    const rss = await loadRss(filePath);
    const newItem = createNewItem();
    insertNewItem(rss, newItem);
    saveRss(filePath, rss);
    console.log("New item added to the RSS feed.");
  } catch (err) {
    console.error(`Error: ${err.message}`);
  }
})();
