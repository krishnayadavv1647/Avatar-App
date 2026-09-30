/**
 * Ready-made faces for the avatar creator's Library, so it is never empty on a
 * new workspace: 25 female and 25 male head-and-shoulders portraits.
 *
 * They are real photographs from Unsplash (free to use, including
 * commercially), served from Unsplash's CDN rather than copied into the repo.
 * The crop is Unsplash's face-area crop at 3:4, so every picture is a face with
 * shoulders rather than a full-length shot - what a talking avatar needs.
 * Photographers are credited on each entry.
 *
 * Picking one creates an ordinary photo avatar with whichever vendor photo
 * avatars go to; see studioService.createFromStock. Only ids from this list
 * are accepted, so the Library cannot be used to send the vendor an arbitrary
 * URL.
 */

/** The pseudo-provider id Library faces travel under in the stock list. */
export const FACE_LIBRARY = "library";

const url = (photo) =>
  `https://images.unsplash.com/photo-${photo}?w=600&h=800&fit=facearea&facepad=3.2&fm=jpg&q=80`;

const female = [
  ["Aisha", "1573497019940-1c28c88b4f3e", "Christina @ wocintechchat.com"],
  ["Emma", "1580489944761-15a19d654956", "Jake Nackos"],
  ["Sofia", "1494790108377-be9c29b29330", "Michael Dam"],
  ["Maya", "1573497161161-c3e73707e25c", "Christina @ wocintechchat.com"],
  ["Olivia", "1589729132389-8f0e0b55b91e", "Zoran Borojevic"],
  ["Chloe", "1627161683077-e34782c24d81", "Clay Elliot"],
  ["Grace", "1701096374092-bb70915fdc5c", "Troy Spoelma"],
  ["Leah", "1745434159123-5b99b94206ca", "Brooke Balentine"],
  ["Zara", "1609436132311-e4b0c9370469", "Andre Styles"],
  ["Isabel", "1656074520589-bd325dc7aa4f", "Lance Reis"],
  ["Hannah", "1745434159123-4908d0b9df94", "Brooke Balentine"],
  ["Nia", "1573497491765-dccce02b29df", "Christina @ wocintechchat.com"],
  ["Priya", "1606335192038-f5a05f761b3a", "Dillon Kydd"],
  ["Ruby", "1553514029-1318c9127859", "Connor Wilkins"],
  ["Laila", "1689600944138-da3b150d9cb8", "Philip White"],
  ["Amara", "1659481993364-4512775ed911", "Brian Wangenheim"],
  ["Tara", "1573497161374-439a30d308db", "Christina @ wocintechchat.com"],
  ["Sara", "1760552069633-c05f246a5d8c", "amin naderloei"],
  ["Ava", "1544005313-94ddf0286df2", "Štefan Štefančík"],
  ["Ananya", "1706943262459-3ef6ce03305c", "siddharth vyas"],
  ["Meera", "1609371497456-3a55a205d5eb", "Andre Styles"],
  ["Kavya", "1765005204058-10418f5123c5", "Joecalih"],
  ["Riya", "1784652952109-3004215f6303", "McFollis"],
  ["Neha", "1594756154841-ac5d160dbf46", "Megan Bucknall"],
  ["Mei", "1690444963408-9573a17a8058", "Hale Tat"],
];

const male = [
  ["Daniel", "1500648767791-00dcc994a43e", "Jurica Koletić"],
  ["Marcus", "1595211877493-41a4e5f236b3", "Ryan Hoffman"],
  ["James", "1507003211169-0a1dd7228f2d", "Joseph Gonzalez"],
  ["Kwame", "1588178454780-441fa5b99fa5", "tekimax"],
  ["David", "1650091903029-fc3f1ddcb7f9", "Abu Saied"],
  ["Omar", "1629425733761-caae3b5f2e50", "Willian Souza"],
  ["Ethan", "1560250097-0b93528c311a", "LinkedIn Sales Solutions"],
  ["Lucas", "1705645930353-0e335311ef20", "Danny Postma"],
  ["Ryan", "1549473448-b0acc73629dc", "Spencer Russell"],
  ["Noah", "1590086782957-93c06ef21604", "Ludovic Migneault"],
  ["Samuel", "1652471943570-f3590a4e52ed", "Tony Luginsland"],
  ["Adrian", "1624395213232-ea2bcd36b865", "Nartan Büyükyıldız"],
  ["Leo", "1657218380188-40c56bfdf97f", "Ansspvt Titan"],
  ["Yusuf", "1672685667592-0392f458f46f", "Mohamed Elwaid"],
  ["Arjun", "1649433658557-54cf58577c68", "Abhishek Rai"],
  ["Victor", "1748572593891-049121e2e1ee", "Gabriel Ogulu"],
  ["Ben", "1600603406200-5b2a104684ac", "Vicky Hladynets"],
  ["Tom", "1614321375197-c5083895b054", "Artem Kryzhanivskyi"],
  ["Rahul", "1611178206041-54d5e075be45", "Noah Blaine Clark"],
  ["Karan", "1618306842557-a2515acf2112", "Kamran Ch"],
  ["Vikram", "1658797126061-200e0f8aa2dc", "Sharon Manuel joy"],
  ["Kabir", "1771766691105-455a273c6ca6", "Ahmadreza Rezaie"],
  ["Rohan", "1787484615238-e8ffeee37b57", "AJOY DAS"],
  ["Aarav", "1712425718137-491250cfde88", "ARTO SURAJ"],
  ["Dev", "1600878459138-e1123b37cb30", "itay verchik"],
];

const entries = (list, gender) =>
  list.map(([name, photo, credit], i) => ({
    id: `face_${gender[0]}${String(i + 1).padStart(2, "0")}`,
    name,
    gender,
    url: url(photo),
    credit: `${credit} / Unsplash`,
  }));

export const FACES = [...entries(female, "female"), ...entries(male, "male")];

export const findFace = (id) => FACES.find((f) => f.id === id);

/** The Library faces in the shape the studio's stock list uses. */
export const libraryStock = () =>
  FACES.map((f) => ({
    providerId: FACE_LIBRARY,
    providerAvatarId: f.id,
    name: f.name,
    previewUrl: f.url,
    gender: f.gender,
  }));
