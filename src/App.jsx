import React, { useState, useEffect, useMemo, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { FALLBACK_LISTINGS } from "./fallbackListings.jsx";
import { typeColors } from "./typeColors.jsx";
import { getDistanceMiles } from "./utils.jsx";
import { BrandBear, SceneBg, isOnToday, isOnDay, isOnWeekend, isOnThisWeek, isAlwaysAvailable, isExpiredEvent, getNextSession, getSessionSummary, shareWhatsApp, MapView, ListingCard, DetailView } from "./components.jsx";

// ── SEO Landing Page ──────────────────────────────────────────────────────────
function EalingSEOPage({ listings, onActivityClick }) {
  const TYPE_BG = { Music:"#FEE2E2", Sensory:"#E0E7FF", "Messy Play":"#FCE7F3", Dance:"#FEF3C7", Yoga:"#D1FAE5", Outdoor:"#D1FAE5", Park:"#D1FAE5", Animals:"#D1FAE5", "Soft Play":"#EDE9FE", Play:"#EDE9FE", "Toddler Group":"#FFF7ED", Chess:"#E0E7FF", Football:"#D1FAE5", default:"#F3F4F6" };
  const TYPE_COL = { Music:"#991B1B", Sensory:"#3730A3", "Messy Play":"#9D174D", Dance:"#92400E", Yoga:"#065F46", Outdoor:"#065F46", Park:"#065F46", Animals:"#065F46", "Soft Play":"#5B21B6", Play:"#5B21B6", "Toddler Group":"#9A3412", Chess:"#3730A3", Football:"#065F46", default:"#374151" };

  const score = (l) => {
    let s = 0;
    if ((l.images && l.images.length > 0) || l.logo || l.imageUrl) s += 10;
    if (l.description && l.description.length > 30) s += 2;
    if (l.website || l.trialLink) s += 1;
    if (l.popular) s += 2;
    return s;
  };

  const ealingListings = useMemo(() => {
    const ealingAreas = ["Ealing","Hanwell","West Ealing","North Ealing","South Ealing","Acton","Chiswick","Northfields"];
    return listings
      .filter(l => ealingAreas.some(a => (l.location || "").includes(a)))
      .sort((a, b) => score(b) - score(a));
  }, [listings]);

  const outdoor = ealingListings.filter(l => {
    const t = (l.type || "").toLowerCase(), n = (l.name || "").toLowerCase();
    return !l.indoor || ["outdoor","park","playground","nature","animal","zoo","garden"].some(k => t.includes(k) || n.includes(k));
  }).slice(0, 4);

  const classes = ealingListings.filter(l => {
    const t = (l.type || "").toLowerCase(), n = (l.name || "").toLowerCase(), ages = (l.ages || "").toLowerCase();
    return ["music","sensory","messy play","dance","yoga","signing","baby","toddler","rhyme"].some(k => t.includes(k) || n.includes(k) || ages.includes(k));
  }).slice(0, 4);

  const free = ealingListings.filter(l => l.free || (l.price || "").toLowerCase().includes("free")).slice(0, 4);
  const popular = ealingListings.filter(l => l.popular || l.verified || l.featuredProvider).slice(0, 4);
  const popularFallback = popular.length >= 2 ? popular : ealingListings.slice(0, 4);

  const Card = ({ item }) => {
    const bg = TYPE_BG[item.type] || TYPE_BG.default;
    const col = TYPE_COL[item.type] || TYPE_COL.default;
    const img = item.logo || item.imageUrl || (item.images && item.images[0]);
    const isFree = item.free || (item.price || "").toLowerCase().includes("free");
    return (
      <div onClick={() => onActivityClick(item)} style={{ background:"white", borderRadius:14, border:"1px solid #E5E7EB", padding:16, marginBottom:12, display:"flex", gap:14, cursor:"pointer", boxShadow:"0 1px 4px rgba(0,0,0,0.05)" }}>
        <div style={{ width:64, height:64, borderRadius:12, background:`linear-gradient(135deg,${bg},${bg}dd)`, flexShrink:0, position:"relative", overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center" }}>
          {img && <img src={img} alt="" style={{ width:"78%", height:"78%", objectFit:"cover", position:"absolute", top:"11%", left:"11%", borderRadius:"50%" }} onError={e => e.target.style.display="none"} />}
          <span style={{ fontSize:22, fontWeight:800, color:col, position:"relative", zIndex:2 }}>{(item.type||"A").charAt(0)}</span>
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:15, fontWeight:700, color:"#111827", marginBottom:3 }}>{item.name}</div>
          <div style={{ fontSize:12, color:"#4B5563", marginBottom:3 }}>{item.type}{item.ages ? " · " + item.ages : ""}{item.day ? " · " + item.day : ""}</div>
          <div style={{ fontSize:12, color:"#6B7280" }}>{item.venue ? item.venue.split(",")[0] + ", " : ""}{item.location}</div>
          {(item.freeTrial || item.popular) && (
            <div style={{ display:"flex", gap:6, marginTop:6 }}>
              {item.freeTrial && <span style={{ fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:6, background:"#DCFCE7", color:"#166534" }}>Free trial</span>}
              {item.popular && <span style={{ fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:6, background:"#FEF3C7", color:"#92400E" }}>⭐ Popular</span>}
            </div>
          )}
        </div>
        <div style={{ flexShrink:0, alignSelf:"flex-start" }}>
          {item.price && <div style={{ fontSize:12, fontWeight:700, padding:"5px 10px", borderRadius:8, background: isFree ? "#DCFCE7" : "#FFF7ED", color: isFree ? "#166534" : "#9A3412", whiteSpace:"nowrap" }}>{item.price}</div>}
        </div>
      </div>
    );
  };

  const Section = ({ id, eyebrow, title, desc, items }) => (
    <section id={id} style={{ padding:"28px 20px 8px" }}>
      <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.8px", color:"#F97316", marginBottom:4 }}>{eyebrow}</div>
      <h2 style={{ fontFamily:"Georgia,serif", fontSize:22, fontWeight:800, color:"#111827", marginBottom:6, lineHeight:1.25 }}>{title}</h2>
      <p style={{ fontSize:14, color:"#4B5563", marginBottom:16, lineHeight:1.55 }}>{desc}</p>
      {items.length > 0 ? items.map(item => <Card key={item.id} item={item} />) : <p style={{ fontSize:13, color:"#9CA3AF" }}>Loading activities…</p>}
      <div onClick={() => window.location.href = "/"} style={{ textAlign:"center", padding:"8px 0 4px", fontSize:13, fontWeight:600, color:"#F97316", cursor:"pointer" }}>Browse all {eyebrow.toLowerCase()} →</div>
    </section>
  );

  const faqItems = [
    { q:"What are the best free things to do with kids in Ealing?", a:"Pitzhanger Park Play Centre in Walpole Park has a great free playground for under 5s. Gunnersbury Park has a nature play area, lake and miniature railway. Many local churches run free toddler groups — LITTLElocals lists all free activities with a Free filter." },
    { q:"What baby classes are available in Ealing?", a:"Ealing has Hartbeeps (baby sensory and music), Sing and Sign (baby signing), Baby Sensory, and various toddler yoga and movement classes. Most run weekly and many offer free trial classes." },
    { q:"Are there activities for toddlers in Ealing on weekdays?", a:"Yes — most baby and toddler classes run Monday to Friday. There are also daily soft play centres, parks with playgrounds, and toddler groups throughout the week. LITTLElocals has a Today filter so you instantly see what's on right now." },
    { q:"Is Hanwell Zoo good for toddlers?", a:"Brent Lodge Park (Hanwell Zoo) is excellent for toddlers. Entry is £5 per person with a small zoo, miniature train, and large parkland. Open daily — one of the most popular family spots in the Ealing borough." },
    { q:"How do I find what's on today for kids in Ealing?", a:"LITTLElocals shows Top things to do today based on your day of the week. Filter by area, age, price and type. Free to use, updated weekly by local parents." },
  ];
  const [openFaq, setOpenFaq] = useState(null);

  return (
    <div style={{ maxWidth:640, margin:"0 auto", background:"#FAFAF8", minHeight:"100vh", fontFamily:"'DM Sans',system-ui,sans-serif", color:"#1F2937" }}>
      {/* Nav */}
      <nav style={{ background:"white", borderBottom:"1px solid #E5E7EB", padding:"14px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, zIndex:100 }}>
        <div onClick={() => window.location.href="/"} style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer" }}>
          <img src="/bear-logo.png" alt="LITTLElocals" style={{ width:28, height:28, borderRadius:6 }} />
          <span style={{ fontFamily:"Georgia,serif", fontSize:18, fontWeight:900 }}>LITTLE<span style={{ color:"#F97316" }}>locals</span></span>
        </div>
        <div onClick={() => window.location.href="/"} style={{ background:"#F97316", color:"white", padding:"8px 16px", borderRadius:20, fontSize:13, fontWeight:700, cursor:"pointer" }}>Browse all →</div>
      </nav>

      {/* Breadcrumb */}
      <div style={{ padding:"10px 20px", fontSize:12, color:"#9CA3AF" }}>
        <span onClick={() => window.location.href="/"} style={{ color:"#F97316", cursor:"pointer" }}>Home</span> › Things to do with kids in Ealing
      </div>

      {/* Hero */}
      <header style={{ background:"linear-gradient(135deg,#FFF7ED,#FFFBF5,#F0FDF4)", padding:"32px 20px 28px", borderBottom:"1px solid #E5E7EB" }}>
        <div style={{ display:"inline-flex", alignItems:"center", gap:6, fontSize:12, fontWeight:700, color:"#F97316", background:"#FFF7ED", border:"1px solid #FED7AA", padding:"4px 12px", borderRadius:20, marginBottom:14 }}>📍 Ealing, West London</div>
        <h1 style={{ fontFamily:"Georgia,serif", fontSize:"clamp(26px,6vw,34px)", fontWeight:900, color:"#111827", lineHeight:1.2, marginBottom:14 }}>
          Best Things To Do<br/>With Kids In <span style={{ color:"#F97316", fontStyle:"italic" }}>Ealing</span>
        </h1>
        <p style={{ fontSize:15, color:"#4B5563", lineHeight:1.65, marginBottom:12 }}>
          LITTLElocals is built by Ealing parents, for Ealing parents. Every activity here has been found, verified, or recommended by local families — from baby sensory classes to free parks, toddler groups to weekend adventures.
        </p>
        <p style={{ fontSize:13, color:"#6B7280", marginBottom:16 }}>
          70+ activities across <strong>Ealing</strong>, <strong>Hanwell</strong>, <strong>Acton</strong>, <strong>Northfields</strong> and <strong>West Ealing</strong>.
        </p>
        <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
          {[["#F97316", `${ealingListings.length || "70"}+ activities in Ealing`], ["#166534","Updated weekly"], ["#6050F0","Free to use"]].map(([col, label]) => (
            <div key={label} style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, fontWeight:600 }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background:col }}></div><span>{label}</span>
            </div>
          ))}
        </div>
      </header>

      {/* Jump nav */}
      <nav style={{ background:"white", borderBottom:"1px solid #E5E7EB", display:"flex", overflowX:"auto", padding:"0 20px", scrollbarWidth:"none" }}>
        {[["#outdoor","☀️ Outdoor"],["#classes","🎶 Baby classes"],["#free","💰 Free things"],["#popular","⭐ Popular"],["#faq","❓ FAQ"]].map(([href, label]) => (
          <a key={href} href={href} style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"12px 14px", fontSize:13, fontWeight:600, color:"#4B5563", textDecoration:"none", whiteSpace:"nowrap", borderBottom:"2px solid transparent" }}>{label}</a>
        ))}
      </nav>

      {/* Intro */}
      <div style={{ background:"white", borderRadius:14, border:"1px solid #E5E7EB", padding:20, margin:"20px 20px 0" }}>
        <h3 style={{ fontFamily:"Georgia,serif", fontSize:17, fontWeight:800, marginBottom:8 }}>Finding things to do with kids in Ealing</h3>
        <p style={{ fontSize:14, color:"#4B5563", lineHeight:1.65, marginBottom:10 }}>Whether you have a newborn, a toddler, or a school-age child, Ealing has a huge range of family-friendly activities year-round. From Walpole Park and Pitzhanger Manor to award-winning baby sensory classes near Ealing Broadway, there's something for every age and budget.</p>
        <p style={{ fontSize:14, color:"#4B5563", lineHeight:1.65 }}>LITTLElocals brings together all family activities in Ealing in one place — classes, parks, soft play, toddler groups, museums and more — so you spend less time searching and more time doing.</p>
      </div>

      <Section id="outdoor" eyebrow="Parks & outdoor fun" title="Best outdoor activities for kids in Ealing ☀️" desc="From nature play to farm animals, Ealing has some of West London's best outdoor spaces for families." items={outdoor} />
      <div style={{ background:"white", borderRadius:14, border:"1px solid #E5E7EB", padding:20, margin:"0 20px 8px" }}>
        <h3 style={{ fontFamily:"Georgia,serif", fontSize:16, fontWeight:800, marginBottom:8 }}>Outdoor activities for toddlers in Ealing</h3>
        <p style={{ fontSize:14, color:"#4B5563", lineHeight:1.65 }}>Pitzhanger Park Play Centre offers free play for under 5s on weekdays. Brent Lodge Park (Hanwell Zoo) is a great low-cost outing with animals and open space. Gunnersbury Park Nature Play gives children of all ages the chance to explore natural outdoor environments.</p>
      </div>

      <Section id="classes" eyebrow="Baby & toddler classes" title="Best baby & toddler classes in Ealing 🎶" desc="Structured classes for babies and toddlers — music, sensory play, signing, movement and more." items={classes} />
      <div style={{ background:"white", borderRadius:14, border:"1px solid #E5E7EB", padding:20, margin:"0 20px 8px" }}>
        <h3 style={{ fontFamily:"Georgia,serif", fontSize:16, fontWeight:800, marginBottom:8 }}>Baby classes in Ealing for 0–12 months</h3>
        <p style={{ fontSize:14, color:"#4B5563", lineHeight:1.65 }}>Hartbeeps runs award-winning baby sensory and music classes from Haven Green Church near Ealing Broadway. Sing and Sign Ealing offers baby signing classes at two venues on Thursdays and Fridays for babies aged 0–24 months. Many classes offer free taster sessions.</p>
      </div>

      <Section id="free" eyebrow="No budget needed" title="Free things to do with kids in Ealing 💰" desc="Great family activities that won't cost a penny — parks, play centres, toddler groups and more." items={free} />

      <Section id="popular" eyebrow="Saved by local parents" title="Popular with Ealing parents ⭐" desc="Activities that Ealing parents keep coming back to — saved, reviewed and recommended by the community." items={popularFallback} />

      {/* FAQ */}
      <section id="faq" style={{ padding:"24px 20px" }}>
        <h2 style={{ fontFamily:"Georgia,serif", fontSize:22, fontWeight:800, color:"#111827", marginBottom:16 }}>Frequently asked questions</h2>
        {faqItems.map((item, i) => (
          <div key={i} style={{ background:"white", border:"1px solid #E5E7EB", borderRadius:14, marginBottom:10, overflow:"hidden" }}>
            <div onClick={() => setOpenFaq(openFaq === i ? null : i)} style={{ padding:"14px 16px", fontSize:14, fontWeight:700, color:"#111827", cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center", gap:12 }}>
              {item.q}
              <span style={{ fontSize:18, color:"#F97316", transform: openFaq===i ? "rotate(45deg)" : "none", transition:"transform 0.2s", flexShrink:0 }}>+</span>
            </div>
            {openFaq === i && <div style={{ padding:"0 16px 14px", fontSize:14, color:"#4B5563", lineHeight:1.65 }}>{item.a}</div>}
          </div>
        ))}
      </section>

      {/* CTA */}
      <div style={{ margin:"0 20px 32px", background:"linear-gradient(135deg,#1F2937,#374151)", borderRadius:18, padding:"24px 20px", textAlign:"center" }}>
        <h3 style={{ fontFamily:"Georgia,serif", fontSize:20, fontWeight:900, color:"white", marginBottom:8 }}>See everything happening in Ealing today</h3>
        <p style={{ fontSize:13, color:"rgba(255,255,255,0.7)", marginBottom:16, lineHeight:1.55 }}>Browse all kids activities in Ealing — baby classes, toddler groups, soft play, parks and more. Free to use, updated weekly by local parents.</p>
        <div onClick={() => window.location.href="/"} style={{ display:"inline-block", background:"#F97316", color:"white", fontSize:14, fontWeight:800, padding:"12px 28px", borderRadius:28, cursor:"pointer", boxShadow:"0 4px 14px rgba(249,115,22,0.4)" }}>👉 Browse all kids activities in Ealing →</div>
      </div>

      <footer style={{ background:"white", borderTop:"1px solid #E5E7EB", padding:20, textAlign:"center", fontSize:12, color:"#9CA3AF" }}>
        <p>© 2025 LITTLElocals. Built by parents, for parents.</p>
        <p style={{ marginTop:6 }}><span onClick={() => window.location.href="/"} style={{ color:"#F97316", cursor:"pointer" }}>Home</span> · <span style={{ color:"#F97316", cursor:"pointer" }}>Privacy</span> · <span style={{ color:"#F97316", cursor:"pointer" }}>Contact</span></p>
      </footer>
    </div>
  );
}

let supabase = null;
try {
  supabase = createClient(
    "https://xjifxwvziwoepiioyitm.supabase.co",
    "sb_publishable__wfpTD3AcZhvRHcS_4LbXg_6E2QkGXv"
  );
} catch(e) {
  console.log("Supabase init failed:", e);
}

function WestLondonListings() {
  const [listings, setListings] = useState(FALLBACK_LISTINGS);
  const [selected, setSelected] = useState(null);
  const [showInstallBanner, setShowInstallBanner] = useState(() => {
    try {
      if (window.matchMedia("(display-mode: standalone)").matches) return false;
      if (window.navigator.standalone === true) return false;
      const visits = parseInt(localStorage.getItem("ll_visit_count") || "0"); localStorage.setItem("ll_visit_count", String(visits + 1)); if (visits < 1) return false; return false;
    } catch(e) { return false; }
  });
  useEffect(() => {
    try {
      const visits = parseInt(localStorage.getItem("ll_visit_count") || "0");
      if (visits < 2 || localStorage.getItem("ll_install_dismissed")) return;
      if (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone) return;
      const t = setTimeout(() => setShowInstallBanner(true), 60000);
      return () => clearTimeout(t);
    } catch(e) {}
  }, []);
  const [isLoading, setIsLoading] = useState(true);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const shownIdsRef = useRef(new Set());
  const [installPrompt, setInstallPrompt] = useState(null);

  // Capture Chrome's install prompt
  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);
  const [typeFilter, setTypeFilter] = useState("All Types");
  const [areaFilter, setAreaFilter] = useState(() => {
    try {
      const areaChips = ["Ealing", "Acton", "Chiswick", "Hanwell", "Northfields", "Ruislip", "Eastcote", "Uxbridge"];
      const norm = s => s.trim().toLowerCase().replace(/['']/g, "").replace(/\s+/g, " ");
      const areaMap = {};
      areaChips.forEach(a => { areaMap[norm(a)] = a; });
      const raw = new URLSearchParams(window.location.search).get("area");
      if (!raw) return "Ealing";
      const match = areaMap[norm(raw)];
      if (match) return match;
      // No match — clean the bad param
      const url = new URL(window.location); url.searchParams.delete("area"); window.history.replaceState({}, "", url);
      return "Ealing";
    } catch(e) { return "Ealing"; }
  });
  const [freeOnly, setFreeOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [userLoc, setUserLoc] = useState(null);
  const [locStatus, setLocStatus] = useState("idle");
  const [isSunny, setIsSunny] = useState(true);
  const [dayFilter, setDayFilter] = useState("today");
  const [weatherMode, setWeatherMode] = useState("all");
  const [napFilter, setNapFilter] = useState("all");
  const [ageFilter, setAgeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [showAllToday, setShowAllToday] = useState(false);
  const [tips, setTips] = useState({});
  const [mapView, setMapView] = useState(false);
  const [sortBy, setSortBy] = useState("mixed");
  const [eventsOnly, setEventsOnly] = useState(false);
  const [worthJourney, setWorthJourney] = useState(false);
  const ITEMS_PER_PAGE = 6;
  const [cityFilter, setCityFilter] = useState(() => {
    try { return localStorage.getItem("ll_city") || "All"; } catch(e) { return "All"; }
  });
  const [reviews, setReviews] = useState([]);
  const [favourites, setFavourites] = useState(() => {
    try { const s = localStorage.getItem("ll_favs"); return s ? JSON.parse(s) : []; } catch(e) { return []; }
  });
  const [passport, setPassport] = useState(() => {
    try { const s = localStorage.getItem("ll_passport"); return s ? JSON.parse(s) : []; } catch(e) { return []; }
  });
  const [clickCounts, setClickCounts] = useState(() => {
    try { return JSON.parse(localStorage.getItem("ll_clicks") || "{}"); } catch(e) { return {}; }
  });
  const trackClick = (id) => {
    setClickCounts(prev => {
      const next = { ...prev, [id]: (prev[id] || 0) + 1 };
      try { localStorage.setItem("ll_clicks", JSON.stringify(next)); } catch(e) {}
      return next;
    });
  };
  const [showFavourites, setShowFavourites] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [calendarPlan, setCalendarPlan] = useState(() => {
    try { const s = localStorage.getItem("ll_calendar_v2"); return s ? JSON.parse(s) : {}; } catch(e) { return {}; }
  });
  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestForm, setSuggestForm] = useState({ name: "", type: "Soft Play", city: "London", location: "", venue: "", ages: "", day: "", time: "", price: "", description: "", submitterName: "", submitterEmail: "" });
  const [suggestedActivities, setSuggestedActivities] = useState([]);
  const [suggestSubmitted, setSuggestSubmitted] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [cookieConsent, setCookieConsent] = useState(() => { try { return localStorage.getItem("ll_cookieConsent"); } catch(e) { return null; } });
  const [legalPage, setLegalPage] = useState(null);

  // Load Google Analytics if consent given
  useEffect(() => {
    if (cookieConsent === "accepted" && !window.gtag) {
      const s = document.createElement("script");
      s.src = "https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX";
      s.async = true;
      document.head.appendChild(s);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function() { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      window.gtag("config", "G-XXXXXXXXXX");
    }
  }, [cookieConsent]);

  const acceptCookies = () => { try { localStorage.setItem("ll_cookieConsent", "accepted"); } catch(e) {} setCookieConsent("accepted"); };
  const declineCookies = () => { try { localStorage.setItem("ll_cookieConsent", "rejected"); } catch(e) {} setCookieConsent("rejected"); };

  // Habit tracking: last visit + first seen
  const [lastVisit] = useState(() => { try { return Number(localStorage.getItem("ll_lastVisit") || 0); } catch(e) { return 0; } });
  const [seenMap] = useState(() => { try { return JSON.parse(localStorage.getItem("ll_seenActivityIds") || "{}"); } catch(e) { return {}; } });
  useEffect(() => { try { localStorage.setItem("ll_lastVisit", String(Date.now())); } catch(e) {} }, []);
  const getFirstSeenAt = (id) => { if (!seenMap[id]) { seenMap[id] = Date.now(); try { localStorage.setItem("ll_seenActivityIds", JSON.stringify(seenMap)); } catch(e) {} } return seenMap[id]; };
  const isNewActivity = (a) => a.createdAt ? (Date.now() - new Date(a.createdAt).getTime()) < 30 * 24 * 60 * 60 * 1000 : false;

  // Load from Supabase on mount (localStorage fallback)
  useEffect(() => {
    // Fetch weather for Ealing (Open-Meteo, no API key needed)
    fetch("https://api.open-meteo.com/v1/forecast?latitude=51.513&longitude=-0.309&current=weather_code&timezone=Europe/London")
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d && d.current && d.current.weather_code !== undefined) {
          // WMO codes: 0-3 = clear/partly cloudy, 45-48 = fog, 51+ = rain/snow
          var sunny = d.current.weather_code <= 3;
          setIsSunny(sunny);
          console.log("Weather code:", d.current.weather_code, "Sunny:", sunny);
        }
      })
      .catch(function(e) { console.log("Weather fetch failed, defaulting to sunny"); });
    (async () => {
      if (!supabase) { console.log("No Supabase client, using fallback"); return; }
      try {
        // Load listings from Supabase
        const { data: ld, error: listErr } = await supabase.from("listings").select("*").order("id", { ascending: true }).limit(500);
        console.log("Listings loaded:", ld ? ld.length : 0, "error:", listErr);
        if (ld && ld.length > 0) {
          setListings(ld.map(l => {
            const slug = (l.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + (l.location || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
            return {
            id: l.id, name: l.name, type: l.type, emoji: l.emoji, slug,
            location: l.location, venue: l.venue, lat: l.lat, lng: l.lng,
            ages: l.ages, day: l.day, time: l.time, price: l.price,
            free: l.free, indoor: l.indoor, description: l.description,
            bring: l.bring || [], sen: l.sen,
            cta: { type: l.cta_type, label: l.cta_label, url: l.cta_url },
            photos: l.photos, verified: l.verified, parking: l.parking,
            timeSlot: l.time_slot, createdAt: l.created_at, popular: l.popular, featuredProvider: l.featured_provider, freeTrial: l.free_trial, trialLink: l.trial_link, website: l.website, imageUrl: l.image_url, suggestedBy: l.suggested_by,
            logo: l.logo || null, images: l.images || [],
            // Structured schedule fields (v2)
            daysOfWeek: l.days_of_week || null,          // e.g. ["mon","wed","fri"]
            isDaily: l.is_daily || false,                 // true = runs every day
            eventDates: l.event_dates || null,            // e.g. ["2026-03-14"]
            termTimeOnly: l.term_time_only || false,      // exclude during school holidays
            needsScheduleUpdate: l.needs_schedule_update || false, // Various — exclude from Today
            // Sessions schema (v3)
            sessions: l.sessions || null,                 // [{day:"Mon",startTime:"10:00",endTime:"11:00"}]
            listingType: l.listing_type || "activity",   // "activity" | "event"
            isEvent: (l.listing_type === "event"),
            eventStartDate: l.event_start_date || null,  // "2026-04-01"
            eventEndDate: l.event_end_date || null,       // "2026-04-14"
            recurrence: l.recurrence || "weekly",         // "weekly"|"one-off"|"multi-day"
            isTemporary: l.is_temporary || false,
          };}));

        // Fetch listing_images and attach to listings
        const { data: imgData } = await supabase.from("listing_images").select("*").order("sort_order", { ascending: true });
        if (imgData && imgData.length > 0) {
          const imgMap = {};
          imgData.forEach(img => {
            if (!imgMap[img.listing_id]) imgMap[img.listing_id] = [];
            imgMap[img.listing_id].push(img.url);
          });
          setListings(prev => prev.map(l => ({ ...l, images: imgMap[l.id] || l.images || [] })));
        }
          try { localStorage.setItem("ll_listings_cache", JSON.stringify(ld)); } catch(e) {}
        }
        // Load reviews
        const { data: rd } = await supabase.from("reviews").select("*").order("created_at", { ascending: false });
        if (rd) {
          setReviews(rd.map(r => ({ id: r.id, listingId: r.listing_id, name: r.reviewer_name, rating: r.rating, text: r.review_text, photos: r.photos || [], date: new Date(r.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) })));
          try { localStorage.setItem("ll_reviews", JSON.stringify(rd)); } catch(e) {}
        }
        // Load suggestions
        const { data: sd } = await supabase.from("suggestions").select("*").order("created_at", { ascending: false });
        if (sd) setSuggestedActivities(sd.map(s => ({ ...s, submitterName: s.submitter_name, submittedAt: new Date(s.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) })));
        const { data: tipsData } = await supabase.from("parent_tips").select("*").order("created_at", { ascending: true });
        if (tipsData) {
          const tipsMap = {};
          tipsData.forEach(t => { if (!tipsMap[t.activity_id]) tipsMap[t.activity_id] = []; tipsMap[t.activity_id].push(t); });
          setTips(tipsMap);
        }
      } catch(e) {
        console.log("Supabase unavailable, trying local cache");
        try {
          const cachedListings = localStorage.getItem("ll_listings_cache");
          if (cachedListings) {
            const ld = JSON.parse(cachedListings);
            setListings(ld.map(l => {
              const slug = (l.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + (l.location || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
              return {
              id: l.id, name: l.name, type: l.type, emoji: l.emoji, slug,
              location: l.location, venue: l.venue, lat: l.lat, lng: l.lng,
              ages: l.ages, day: l.day, time: l.time, price: l.price,
              free: l.free, indoor: l.indoor, description: l.description,
              bring: l.bring || [], sen: l.sen,
              cta: { type: l.cta_type, label: l.cta_label, url: l.cta_url },
              photos: l.photos, verified: l.verified, parking: l.parking,
              timeSlot: l.time_slot, createdAt: l.created_at, popular: l.popular, featuredProvider: l.featured_provider, freeTrial: l.free_trial, trialLink: l.trial_link, website: l.website, imageUrl: l.image_url, suggestedBy: l.suggested_by,
              logo: l.logo || null, images: l.images || [],
            };}));
          }
        } catch(e2) {}
        try { const sr = localStorage.getItem("ll_reviews"); if (sr) { const rd = JSON.parse(sr); setReviews(rd.map(r => ({ id: r.id, listingId: r.listing_id || r.listingId, name: r.reviewer_name || r.name, rating: r.rating, text: r.review_text || r.text, photos: r.photos || [], date: r.date || new Date(r.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) }))); } } catch(e2) {}
        try { const ss = localStorage.getItem("ll_suggestions"); if (ss) setSuggestedActivities(JSON.parse(ss)); } catch(e2) {}
      }
      setIsLoading(false);
    })();
  }, []);

  // Browser back button support + deep link URL handling
  useEffect(() => {
    const handlePop = () => {
      const path = window.location.pathname;
      if (path.startsWith("/activity/")) {
        const slug = path.replace("/activity/", "");
        const match = listings.find(a => a.slug === slug);
        if (match) { setSelected(match); window.scrollTo(0, 0); return; }
      }
      if (selected) { setSelected(null); window.history.replaceState({}, "", "/"); return; }
      if (showCalendar) { setShowCalendar(false); return; }
      if (showSuggest) { setShowSuggest(false); return; }
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, [selected, showCalendar, showSuggest, listings]);

  // Deep link: open activity from URL on load
  useEffect(() => {
    if (listings.length === 0) return;
    const path = window.location.pathname;
    if (path.startsWith("/activity/")) {
      const slug = path.replace("/activity/", "");
      const match = listings.find(a => a.slug === slug);
      if (match) { setSelected(match); window.scrollTo(0, 0); }
    }
  }, [listings]);

  // Push history state when opening views
  const openDetail = (item) => { window.history.pushState({ view: "detail" }, "", "/activity/" + (item.slug || item.id)); setSelected(item); window.scrollTo(0, 0); };
  const openCalendar = () => { const now = new Date(); setCalMonth(now.getMonth()); setCalYear(now.getFullYear()); setSelectedDate(now.toISOString().split("T")[0]); window.history.pushState({ view: "calendar" }, ""); setShowCalendar(true); };
  const openSuggest = () => { window.history.pushState({ view: "suggest" }, ""); setShowSuggest(true); };

  const closeDetail = () => { window.history.pushState({}, "", "/"); setSelected(null); };
  const closeCalendar = () => { if (window.history.state?.view) window.history.back(); else setShowCalendar(false); };
  const closeSuggest = () => { if (window.history.state?.view) window.history.back(); else setShowSuggest(false); };

  // Scroll to top button visibility
  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Pull to refresh
  const refreshData = async () => {
    if (!supabase || pullRefreshing) return;
    setPullRefreshing(true);
    try {
      const { data: ld } = await supabase.from("listings").select("*").order("id", { ascending: true }).limit(500);
      if (ld && ld.length > 0) {
        setListings(ld.map(l => {
          const slug = (l.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + (l.location || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          return {
          id: l.id, name: l.name, type: l.type, emoji: l.emoji, slug,
          location: l.location, venue: l.venue, lat: l.lat, lng: l.lng,
          ages: l.ages, day: l.day, time: l.time, price: l.price,
          free: l.free, indoor: l.indoor, description: l.description,
          bring: l.bring || [], sen: l.sen,
          cta: { type: l.cta_type, label: l.cta_label, url: l.cta_url },
          photos: l.photos, verified: l.verified, parking: l.parking,
          timeSlot: l.time_slot, createdAt: l.created_at, popular: l.popular, featuredProvider: l.featured_provider, freeTrial: l.free_trial, trialLink: l.trial_link, website: l.website, imageUrl: l.image_url, suggestedBy: l.suggested_by,
          logo: l.logo || null, images: l.images || [],
        };}));
      }
      // Refresh listing_images
      const { data: imgData2 } = await supabase.from("listing_images").select("*").order("sort_order", { ascending: true });
      if (imgData2 && imgData2.length > 0) {
        const imgMap2 = {};
        imgData2.forEach(img => {
          if (!imgMap2[img.listing_id]) imgMap2[img.listing_id] = [];
          imgMap2[img.listing_id].push(img.url);
        });
        setListings(prev => prev.map(l => ({ ...l, images: imgMap2[l.id] || l.images || [] })));
      }
            const { data: rd } = await supabase.from("reviews").select("*").order("created_at", { ascending: false });
      if (rd) setReviews(rd.map(r => ({ id: r.id, listingId: r.listing_id, name: r.reviewer_name, rating: r.rating, text: r.review_text, photos: r.photos || [], date: new Date(r.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) })));
    } catch(e) {}
    setPullRefreshing(false);
  };

  // Backup to localStorage
  useEffect(() => { try { localStorage.setItem("ll_city", cityFilter); } catch(e) {} }, [cityFilter]);
  useEffect(() => { try { localStorage.setItem("ll_reviews", JSON.stringify(reviews)); } catch(e) {} }, [reviews]);
  useEffect(() => { try { localStorage.setItem("ll_suggestions", JSON.stringify(suggestedActivities)); } catch(e) {} }, [suggestedActivities]);

  // Sync area filter to URL
  useEffect(() => {
    try {
      const url = new URL(window.location);
      if (!window.location.pathname.startsWith("/admin")) {
        if (areaFilter !== "All Areas") { url.searchParams.set("area", areaFilter); } else { url.searchParams.delete("area"); }
        window.history.replaceState({}, "", url);
      }
    } catch(e) {}
  }, [areaFilter]);

  // Reset to page 1 when any filter changes
  useEffect(() => { setPage(1); }, [cityFilter, typeFilter, areaFilter, freeOnly, search, dayFilter, weatherMode, napFilter, ageFilter, eventsOnly, worthJourney]);

  // Persist favourites
  useEffect(() => { try { localStorage.setItem("ll_favs", JSON.stringify(favourites)); } catch(e) {} }, [favourites]);
  useEffect(() => { try { localStorage.setItem("ll_passport", JSON.stringify(passport)); } catch(e) {} }, [passport]);
  useEffect(() => { try { localStorage.setItem("ll_calendar_v2", JSON.stringify(calendarPlan)); } catch(e) {} }, [calendarPlan]);

  const addToCalendar = (activityId, dateKey) => {
    if (navigator.vibrate) navigator.vibrate(10);
    setCalendarPlan(prev => {
      const day = prev[dateKey] || [];
      if (day.includes(activityId)) return prev;
      return { ...prev, [dateKey]: [...day, activityId] };
    });
  };

  const removeFromCalendar = (activityId, dateKey) => {
    setCalendarPlan(prev => {
      const updated = (prev[dateKey] || []).filter(id => id !== activityId);
      const newPlan = { ...prev, [dateKey]: updated };
      if (updated.length === 0) delete newPlan[dateKey];
      return newPlan;
    });
  };

  const calendarTotal = Object.values(calendarPlan).reduce((sum, arr) => sum + arr.length, 0);

  const toggleFavourite = (id) => {
    if (navigator.vibrate) navigator.vibrate(10);
    setFavourites(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]);
  };

  const togglePassport = (id) => {
    if (navigator.vibrate) navigator.vibrate(15);
    setPassport(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);
  };

  const addReview = async (review) => {
    const temp = { ...review, id: Date.now(), date: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) };
    setReviews(prev => [temp, ...prev]);
    try {
      const { data } = await supabase.from("reviews").insert({ listing_id: review.listingId, reviewer_name: review.name, rating: review.rating, review_text: review.text, photos: review.images || review.photos || [] }).select().single();
      if (data) setReviews(prev => prev.map(r => r.id === temp.id ? { id: data.id, listingId: data.listing_id, name: data.reviewer_name, rating: data.rating, text: data.review_text, photos: data.photos || [], date: new Date(data.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) } : r));
    } catch(e) {}
  };

  const addTip = async (activityId, tipText) => {
    const trimmed = tipText.trim().slice(0, 120);
    if (!trimmed) return;
    const temp = { id: "tmp-" + Date.now(), activity_id: activityId, tip_text: trimmed, created_at: new Date().toISOString() };
    setTips(prev => ({ ...prev, [activityId]: [...(prev[activityId] || []), temp] }));
    try {
      const { data } = await supabase.from("parent_tips").insert({ activity_id: activityId, tip_text: trimmed }).select().single();
      if (data) setTips(prev => ({ ...prev, [activityId]: (prev[activityId] || []).map(t => t.id === temp.id ? data : t) }));
    } catch(e) {}
  };

  const submitSuggestion = async () => {
    if (!suggestForm.name.trim() || !suggestForm.venue.trim() || !suggestForm.submitterName.trim() || !suggestForm.location) return;
    const temp = { ...suggestForm, id: Date.now(), status: "pending", submittedAt: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) };
    setSuggestedActivities(prev => [...prev, temp]);
    try {
      await supabase.from("suggestions").insert({ name: suggestForm.name, type: suggestForm.type, city: suggestForm.city, location: suggestForm.location, venue: suggestForm.venue, ages: suggestForm.ages, day: suggestForm.day + (suggestForm.time ? " " + suggestForm.time : ""), price: suggestForm.price, description: suggestForm.description, submitter_name: suggestForm.submitterName, submitter_email: suggestForm.submitterEmail });
    } catch(e) {}
    setSuggestForm({ name: "", type: "Soft Play", city: "London", location: "", venue: "", ages: "", day: "", time: "", price: "", description: "", submitterName: "", submitterEmail: "" });
    setShowSuggest(false);
    setSuggestSubmitted(true);
    setTimeout(() => setSuggestSubmitted(false), 5000);
  };

  const requestLocation = () => {
    if (!navigator.geolocation) { setLocStatus("denied"); return; }
    setLocStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      (pos) => { setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLocStatus("granted"); setSortBy("nearest"); setAreaFilter("All Areas"); setPage(1); },
      (err) => { console.log("Location error:", err.message); setLocStatus("denied"); },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 }
    );
  };

// Smart search keywords — maps common search terms to activity types and specific listings
const searchKeywords = {
  // Dance & movement
  "dance": ["Music", "Performing Arts", "Sport"],
  "ballet": ["Performing Arts"],
  "street dance": ["Performing Arts"],
  "tap": ["Performing Arts"],
  "movement": ["Music", "Performing Arts"],
  "disco": ["Music", "Performing Arts"],
  // Arts & making
  "pottery": ["Arts & Crafts", "Baking"],
  "painting": ["Arts & Crafts", "Messy Play"],
  "ceramics": ["Arts & Crafts"],
  "drawing": ["Arts & Crafts"],
  "creative": ["Arts & Crafts", "Messy Play", "Baking"],
  "craft": ["Arts & Crafts", "Messy Play"],
  "art": ["Arts & Crafts", "Messy Play"],
  "make": ["Arts & Crafts", "Baking"],
  // Physical
  "trampoline": ["Sport"],
  "gymnastics": ["Sport"],
  "circus": ["Sport"],
  "climbing": ["Sport", "Outdoor"],
  "football": ["Sport"],
  "tennis": ["Sport", "Outdoor"],
  "jump": ["Sport"],
  "bounce": ["Soft Play", "Sport"],
  "active": ["Sport", "Soft Play", "Outdoor"],
  "exercise": ["Sport", "Swimming"],
  // Water
  "swim": ["Swimming"],
  "pool": ["Swimming"],
  "water": ["Swimming", "Messy Play", "Outdoor"],
  "splash": ["Swimming", "Outdoor"],
  // Nature & outdoors
  "park": ["Outdoor"],
  "garden": ["Outdoor"],
  "nature": ["Outdoor"],
  "walk": ["Outdoor"],
  "forest": ["Outdoor"],
  "woods": ["Outdoor"],
  "playground": ["Outdoor"],
  "picnic": ["Outdoor"],
  "animals": ["Outdoor"],
  "ducks": ["Outdoor"],
  "beach": ["Outdoor"],
  // Learning & development
  "sing": ["Music", "Story Time"],
  "song": ["Music", "Story Time"],
  "rhyme": ["Story Time", "Music"],
  "reading": ["Story Time"],
  "books": ["Story Time"],
  "library": ["Story Time"],
  "learn": ["Messy Play", "Story Time", "Performing Arts"],
  "educational": ["Messy Play", "Story Time"],
  // Social
  "baby group": ["Playgroup", "Music"],
  "toddler group": ["Playgroup"],
  "mum": ["Playgroup"],
  "parent": ["Playgroup"],
  "social": ["Playgroup", "Soft Play"],
  "friends": ["Playgroup", "Soft Play"],
  "drop in": ["Playgroup"],
  "free": ["Playgroup", "Outdoor"],
  // Sensory & messy
  "sensory": ["Messy Play", "Music", "Soft Play"],
  "messy": ["Messy Play"],
  "slime": ["Messy Play"],
  "paint": ["Messy Play", "Arts & Crafts"],
  "sand": ["Messy Play", "Outdoor"],
  "play dough": ["Messy Play", "Arts & Crafts"],
  // Food
  "cook": ["Baking"],
  "bake": ["Baking"],
  "cake": ["Baking"],
  "food": ["Baking"],
  // Needs
  "sen": ["Playgroup", "Swimming"],
  "disability": ["Playgroup", "Swimming"],
  "additional needs": ["Playgroup", "Swimming"],
  "accessible": ["Outdoor", "Playgroup"],
  // Entertainment
  "theatre": ["Performing Arts"],
  "drama": ["Performing Arts"],
  "acting": ["Performing Arts"],
  "show": ["Performing Arts", "Music"],
  "perform": ["Performing Arts"],
  "stage": ["Performing Arts"],
  // Play
  "soft play": ["Soft Play"],
  "ball pit": ["Soft Play"],
  "slide": ["Soft Play", "Outdoor"],
  "indoor play": ["Soft Play"],
  // Transport themed
  "train": ["Outdoor"],
  "railway": ["Outdoor"],
  "miniature": ["Outdoor"],
};

// City groupings for the city picker
const cityGroups = {
  "London": ["Acton", "Barnet", "Battersea", "Bethnal Green", "Brentford", "Brixton", "Camden", "Canary Wharf", "Chiswick", "Clapham", "Covent Garden", "Croydon", "Crystal Palace", "Dulwich", "Ealing", "Eastcote", "Edgware", "Feltham", "Finchley", "Forest Hill", "Greenford", "Greenwich", "Hackney", "Hammersmith", "Hampstead", "Hanwell", "Harrow", "Hayes", "Highgate", "Hillingdon", "Hounslow", "Ickenham", "Isleworth", "Islington", "Kensington", "Kew", "Lea Bridge", "Lewisham", "London Bridge", "Northfields", "Northolt", "Northwood", "Peckham", "Pinner", "Pitshanger", "Regent's Park", "Richmond", "Romford", "Ruislip", "Shepherd's Bush", "Silvertown", "South Ealing", "South Kensington", "South Ruislip", "Southall", "Southwark", "Stanmore", "Stratford", "Twickenham", "Uxbridge", "Walthamstow", "Wembley", "Westminster", "Wimbledon", "Acton / Chiswick", "Acton / Ealing", "Hillingdon-wide"],
  "Birmingham": ["Birmingham"],
  "Manchester": ["Manchester"],
  "Leeds": ["Leeds"],
  "Liverpool": ["Liverpool"],
  "Hertfordshire": ["Hemel Hempstead", "Watford", "St Albans", "Stevenage", "Hatfield", "Hertford", "Welwyn Garden City"],
  "Buckinghamshire": ["Amersham", "Aylesbury", "Beaconsfield", "Bourne End", "Burnham", "Chesham", "Denham", "Flackwell Heath", "Gerrards Cross", "Great Missenden", "Hazlemere", "High Wycombe", "Iver", "Loudwater", "Maidenhead", "Marlow", "Princes Risborough", "Rickmansworth", "Slough", "Taplow", "Wendover", "Windsor", "Wooburn"],
  "Essex": ["Chelmsford", "Southend", "Colchester", "Basildon", "Brentwood", "Epping", "Harlow", "Braintree", "Maldon", "Thurrock", "Billericay", "Rayleigh", "Wickford", "Benfleet", "Grays", "Loughton", "Chigwell", "Romford"],
};

function getSearchScore(item, query) {
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  
  let score = 0;
  const name = item.name.toLowerCase();
  const type = item.type.toLowerCase();
  const loc = item.location.toLowerCase();
  const desc = item.description.toLowerCase();
  const venue = item.venue.toLowerCase();
  
  // Exact name match — highest priority
  if (name.includes(q)) score += 100;
  // Type match
  if (type.includes(q)) score += 80;
  // Location match
  if (loc.includes(q)) score += 70;
  // Venue match
  if (venue.includes(q)) score += 60;
  // Description match
  if (desc.includes(q)) score += 40;
  
  // Keyword matching — check each keyword
  for (const [keyword, types] of Object.entries(searchKeywords)) {
    if (q.includes(keyword) || keyword.includes(q)) {
      if (types.includes(item.type)) score += 50;
      // Bonus if keyword appears in description too
      if (desc.includes(keyword)) score += 20;
    }
  }
  
  // Multi-word search — check each word
  const words = q.split(/\s+/);
  if (words.length > 1) {
    words.forEach(word => {
      if (word.length < 2) return;
      if (name.includes(word)) score += 30;
      if (type.includes(word)) score += 25;
      if (desc.includes(word)) score += 15;
      if (loc.includes(word)) score += 15;
    });
  }
  
  return score;
}

  const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const dayNamesShort = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const todayName = dayNames[new Date().getDay()];
  const todayNameShort = dayNamesShort[new Date().getDay()];

  const filtered = useMemo(() => {
    let results = listings.filter(l => {
      if (isExpiredEvent(l)) return false; // auto-hide expired temporary events
      if (showFavourites && !favourites.includes(l.id)) return false;
      if (cityFilter !== "All" && !cityGroups[cityFilter]?.some(a => l.location.includes(a))) return false;
      if (typeFilter !== "All Types" && l.type !== typeFilter) return false;
      if (areaFilter !== "All Areas") {
        const ealingBorough = ["Ealing", "Hanwell", "West Ealing", "North Ealing", "South Ealing"];
        if (areaFilter === "Ealing") {
          if (!ealingBorough.some(a => l.location.includes(a))) return false;
        } else {
          if (!l.location.includes(areaFilter)) return false;
        }
      }
      if (!search && freeOnly && !l.free) return false;
      if (!search && eventsOnly && !l.isEvent) return false;
      if (!search && eventsOnly) return true; // show all events bypassing other filters
      if (!search && worthJourney && !l.worthJourney) return false;
      if (!search && dayFilter === "today" && !isOnToday(l)) return false;
      if (!search && dayFilter === "weekend" && !isOnWeekend(l)) return false;
      if (!search && dayFilter === "week" && !isOnThisWeek(l)) return false;
      if (!search && dayFilter !== "all" && dayFilter !== "today" && dayFilter !== "weekend" && dayFilter !== "week" && !isOnDay(l, parseInt(dayFilter))) return false;
      if (!search && weatherMode === "rainy" && !l.indoor) return false;
      if (!search && weatherMode === "sunny" && l.indoor) return false;
      if (napFilter === "morning" && l.timeSlot !== "morning" && l.timeSlot !== "all-day") return false;
      if (napFilter === "afternoon" && l.timeSlot !== "afternoon" && l.timeSlot !== "all-day") return false;
      if (ageFilter !== "all") {
        const a = (l.ages || "").toLowerCase();
        if (a.includes("all ages")) { /* passes */ }
        else {
          const nums = a.match(/\d+/g);
          if (!nums) return false;
          const lo = parseInt(nums[0]);
          const hi = nums.length > 1 ? parseInt(nums[nums.length - 1]) : lo;
          const loYrs = a.includes("mo") && lo < 24 ? lo / 12 : lo;
          const hiYrs = a.includes("mo") && hi < 24 && nums.length === 1 ? hi / 12 : hi;
          if (ageFilter === "0-1" && hiYrs < 0 ) return false;
          if (ageFilter === "0-1" && loYrs > 1) return false;
          if (ageFilter === "1-2" && loYrs > 2) return false;
          if (ageFilter === "1-2" && hiYrs < 1) return false;
          if (ageFilter === "2-4" && loYrs > 4) return false;
          if (ageFilter === "2-4" && hiYrs < 2) return false;
          if (ageFilter === "4-7" && loYrs > 7) return false;
          if (ageFilter === "4-7" && hiYrs < 4) return false;
          if (ageFilter === "7+" && hiYrs < 7) return false;
        }
      }
      if (search) {
        const score = getSearchScore(l, search);
        if (score === 0) return false;
      }
      return true;
    });
    if (search) {
      results.sort((a, b) => getSearchScore(b, search) - getSearchScore(a, search));
    } else if (sortBy === "nearest" && userLoc) {
      results.sort((a, b) => getDistanceMiles(userLoc.lat, userLoc.lng, a.lat, a.lng) - getDistanceMiles(userLoc.lat, userLoc.lng, b.lat, b.lng));
    } else if (sortBy === "price-low") {
      results.sort((a, b) => {
        const pa = a.free ? 0 : parseFloat((a.price.match(/[\d.]+/) || [999])[0]);
        const pb = b.free ? 0 : parseFloat((b.price.match(/[\d.]+/) || [999])[0]);
        return pa - pb;
      });
    } else if (sortBy === "price-high") {
      results.sort((a, b) => {
        const pa = a.free ? 0 : parseFloat((a.price.match(/[\d.]+/) || [0])[0]);
        const pb = b.free ? 0 : parseFloat((b.price.match(/[\d.]+/) || [0])[0]);
        return pb - pa;
      });
    } else if (sortBy === "free-first") {
      results.sort((a, b) => (b.free ? 1 : 0) - (a.free ? 1 : 0));
    } else if (sortBy === "indoor") {
      results.sort((a, b) => (b.indoor ? 1 : 0) - (a.indoor ? 1 : 0));
    } else if (sortBy === "outdoor") {
      results.sort((a, b) => (a.indoor ? 1 : 0) - (b.indoor ? 1 : 0));
    } else if (sortBy === "popular") {
      results.sort((a, b) => {
        const pa = (b.popular ? 3 : 0) + (b.verified ? 2 : 0) + (clickCounts[b.id] || 0);
        const pb = (a.popular ? 3 : 0) + (a.verified ? 2 : 0) + (clickCounts[a.id] || 0);
        return pa - pb;
      });
    } else {
      // Priority score — quality listings surface first
      const BOOSTED = ["sing and sign", "hartbeeps", "little gym", "tumble tots"];
      const FAVS = ["gunnersbury", "pitzhanger", "walpole", "hanwell zoo", "acton park", "nature play"];
      const score = (l) => {
        let s = 0;
        if ((l.images && l.images.length > 0) || l.logo || l.imageUrl) s += 10;
        if (l.description && l.description.length > 30) s += 2;
        if (l.time && l.time.length > 3) s += 1;
        if (l.website || l.trialLink) s += 1;
        const n = (l.name || "").toLowerCase();
        if (FAVS.some(f => n.includes(f))) s += 1;
        if (BOOSTED.some(p => n.includes(p))) s += 1;
        return s;
      };
      results.sort((a, b) => score(b) - score(a));

      // Mix by type for variety
      const types = [...new Set(results.map(r => r.type))];
      const buckets = {};
      types.forEach(t => { buckets[t] = results.filter(r => r.type === t); });
      const mixed = [];
      let safety = results.length + 10;
      while (mixed.length < results.length && safety-- > 0) {
        for (const t of types) {
          if (buckets[t].length > 0) mixed.push(buckets[t].shift());
        }
      }
      results = mixed;
    }

    // Deduplicate by exact name on first page — same name = same provider
    if (!search) {
      const seenNames = new Set();
      const firstPage = [];
      const rest = [];
      for (const r of results) {
        const name = (r.name || "").toLowerCase().trim();
        if (firstPage.length < 12 && !seenNames.has(name)) {
          seenNames.add(name);
          firstPage.push(r);
        } else {
          rest.push(r);
        }
      }
      results = [...firstPage, ...rest];
    }

    // Place Sing and Sign in positions 3–5
    if (!search) {
      const singIdx = results.findIndex(r => r.name && r.name.toLowerCase().includes("sing and sign"));
      if (singIdx > 4) {
        const [singItem] = results.splice(singIdx, 1);
        results.splice(3, 0, singItem);
      }
    }
    // If events mode: sort by date, expired last
    if (eventsOnly) {
      const today = new Date(); today.setHours(0,0,0,0);
      results.sort((x, y) => {
        const xd = x.eventStartDate ? new Date(x.eventStartDate) : null;
        const yd = y.eventStartDate ? new Date(y.eventStartDate) : null;
        const xe = xd && xd < today;
        const ye = yd && yd < today;
        if (xe && !ye) return 1;
        if (!xe && ye) return -1;
        if (!xd && !yd) return 0;
        if (!xd) return 1;
        if (!yd) return -1;
        return xd - yd;
      });
    }
    return results;
  }, [listings, showFavourites, favourites, cityFilter, typeFilter, areaFilter, freeOnly, search, userLoc, dayFilter, weatherMode, napFilter, sortBy, eventsOnly, worthJourney]);

  const areaPreviewCounts = useMemo(() => {
    const counts = {};
    ["Ealing", "Acton", "Chiswick", "Hanwell", "Northfields", "Ruislip", "Eastcote", "Uxbridge"].forEach(area => {
      counts[area] = listings.filter(l => {
        if (isExpiredEvent(l)) return false;
        if (!l.location.includes(area)) return false;
        if (showFavourites && !favourites.includes(l.id)) return false;
        if (cityFilter !== "All" && !cityGroups[cityFilter]?.some(a => l.location.includes(a))) return false;
        if (typeFilter !== "All Types" && l.type !== typeFilter) return false;
        if (freeOnly && !l.free) return false;
        if (dayFilter === "today" && !isOnToday(l)) return false;
        if (dayFilter === "weekend" && !isOnWeekend(l)) return false;
        if (dayFilter === "week" && !isOnThisWeek(l)) return false;
        if (dayFilter !== "all" && dayFilter !== "today" && dayFilter !== "weekend" && dayFilter !== "week" && !isOnDay(l, parseInt(dayFilter))) return false;
        if (weatherMode === "rainy" && !l.indoor) return false;
        if (weatherMode === "sunny" && l.indoor) return false;
        if (napFilter === "morning" && l.timeSlot !== "morning" && l.timeSlot !== "all-day") return false;
        if (napFilter === "afternoon" && l.timeSlot !== "afternoon" && l.timeSlot !== "all-day") return false;
        if (ageFilter !== "all") {
          const a = (l.ages || "").toLowerCase();
          if (!a.includes("all ages")) {
            const nums = a.match(/\d+/g);
            if (!nums) return false;
            const lo = parseInt(nums[0]);
            const hi = nums.length > 1 ? parseInt(nums[nums.length - 1]) : lo;
            const loYrs = a.includes("mo") && lo < 24 ? lo / 12 : lo;
            const hiYrs = a.includes("mo") && hi < 24 && nums.length === 1 ? hi / 12 : hi;
            if (ageFilter === "0-1" && loYrs > 1) return false;
            if (ageFilter === "1-2" && (loYrs > 2 || hiYrs < 1)) return false;
            if (ageFilter === "2-4" && (loYrs > 4 || hiYrs < 2)) return false;
            if (ageFilter === "4-7" && (loYrs > 7 || hiYrs < 4)) return false;
            if (ageFilter === "7+" && hiYrs < 7) return false;
          }
        }
        if (search && getSearchScore(l, search) === 0) return false;
        return true;
      }).length;
    });
    return counts;
  }, [listings, showFavourites, favourites, cityFilter, typeFilter, freeOnly, search, dayFilter, weatherMode, napFilter, ageFilter]);

  const sortedAreas = useMemo(() => {
    const allAreas = ["All Areas", "Chiswick", "Ealing", "Acton", "Hammersmith", "Shepherd's Bush", "Kew", "Ruislip", "Uxbridge", "Eastcote", "Hillingdon", "Ickenham", "Northwood", "Northolt", "South Ruislip", "Camden", "Islington", "Finchley", "Barnet", "Highgate", "Hampstead", "Brixton", "Clapham", "Dulwich", "Greenwich", "Peckham", "Wimbledon", "Crystal Palace", "Forest Hill", "Battersea", "Croydon", "Lewisham", "Stratford", "Hackney", "Canary Wharf", "Romford", "Bethnal Green", "Walthamstow", "Lea Bridge", "Silvertown", "Kensington", "Westminster", "South Kensington", "Southwark", "Covent Garden", "London Bridge", "Regent's Park", "Pinner", "Harrow", "Hayes", "Southall", "Hounslow", "Feltham", "Greenford", "Stanmore", "Edgware", "Wembley", "Hanwell", "Brentford", "Twickenham", "Richmond", "Isleworth", "Hemel Hempstead", "Watford", "St Albans", "Stevenage", "Hatfield", "Hertford", "Welwyn Garden City", "High Wycombe", "Amersham", "Aylesbury", "Marlow", "Beaconsfield", "Chesham", "Princes Risborough", "Slough", "Iver", "Gerrards Cross", "Burnham", "Taplow", "Wendover", "Great Missenden", "Maidenhead", "Windsor", "Denham", "Rickmansworth", "Chelmsford", "Southend", "Colchester", "Basildon", "Brentwood", "Epping", "Harlow", "Braintree", "Maldon", "Thurrock", "Birmingham", "Manchester", "Leeds", "Liverpool"];
    if (!userLoc) return allAreas;
    const areaAvgDist = {};
    allAreas.forEach(area => {
      if (area === "All Areas") { areaAvgDist[area] = -1; return; }
      const al = listings.filter(l => l.location.includes(area));
      if (al.length === 0) { areaAvgDist[area] = 999; return; }
      areaAvgDist[area] = al.reduce((s, l) => s + getDistanceMiles(userLoc.lat, userLoc.lng, l.lat, l.lng), 0) / al.length;
    });
    return allAreas.sort((a, b) => areaAvgDist[a] - areaAvgDist[b]);
  }, [userLoc]);

  const todayCount = useMemo(() => listings.filter(l => isOnToday(l)).length, [listings]);
  const weekendCount = useMemo(() => listings.filter(l => !isExpiredEvent(l) && isOnWeekend(l)).length, [listings]);
  const weekCount = useMemo(() => listings.filter(l => !isExpiredEvent(l) && isOnThisWeek(l)).length, [listings]);

  if (showCalendar) {
    const today = new Date();

    const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const dayLabels = ["Mo","Tu","We","Th","Fr","Sa","Su"];
    const todayKey = today.toISOString().split("T")[0];

    // Build calendar grid
    const firstDay = new Date(calYear, calMonth, 1);
    const lastDay = new Date(calYear, calMonth + 1, 0);
    let startDow = firstDay.getDay(); // 0=Sun
    startDow = startDow === 0 ? 6 : startDow - 1; // convert to 0=Mon
    const daysInMonth = lastDay.getDate();
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);

    const prevMonth = () => { if (calMonth === 0) { setCalMonth(11); setCalYear(calYear - 1); } else setCalMonth(calMonth - 1); };
    const nextMonth = () => { if (calMonth === 11) { setCalMonth(0); setCalYear(calYear + 1); } else setCalMonth(calMonth + 1); };

    const selectedActivities = (calendarPlan[selectedDate] || []).map(id => listings.find(l => l.id === id)).filter(Boolean);

    return (
      <div style={{ maxWidth: 480, margin: "0 auto", background: "#F9FAFB", minHeight: "100vh", fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif", color: "#1F2937", overflowX: "hidden" }}>
        <div style={{ padding: "12px 20px 6px", position: "sticky", top: 0, zIndex: 100, background: "#F9FAFB", borderBottom: "1px solid #E5E7EB" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div onClick={closeCalendar} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <div style={{ width: 60, height: 60, overflow: "hidden", flexShrink: 0, borderRadius: 14, border: "2px solid #E5E7EB" }}><BrandBear size={60} /></div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#6050F0", letterSpacing: -0.3 }}>LITTLE<span style={{ color: "#F97316" }}>locals</span></div>
              </div>
            </div>
            <div onClick={closeCalendar} style={{ padding: "6px 12px", background: "white", borderRadius: 10, border: "1px solid #E5E7EB", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#1F2937" }}>← Back</div>
          </div>
        </div>

        <div style={{ padding: "16px 20px 8px" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#1F2937", marginBottom: 4 }}>📅 My Plans</div>
          <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 12 }}>Tap a date to view or add activities</div>

          {/* Month nav */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div onClick={prevMonth} style={{ padding: "6px 12px", background: "white", borderRadius: 8, border: "1px solid #E5E7EB", cursor: "pointer", fontSize: 14, fontWeight: 700 }}>‹</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#1F2937" }}>{monthNames[calMonth]} {calYear}</div>
            <div onClick={nextMonth} style={{ padding: "6px 12px", background: "white", borderRadius: 8, border: "1px solid #E5E7EB", cursor: "pointer", fontSize: 14, fontWeight: 700 }}>›</div>
          </div>

          {/* Day labels */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
            {dayLabels.map(d => <div key={d} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: "#6B7280", padding: 4 }}>{d}</div>)}
          </div>

          {/* Calendar grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 12 }}>
            {cells.map((d, i) => {
              if (d === null) return <div key={`e${i}`} />;
              const dateKey = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
              const hasPlans = (calendarPlan[dateKey] || []).length > 0;
              const isToday = dateKey === todayKey;
              const isSelected = dateKey === selectedDate;
              const isPast = dateKey < todayKey;
              return (
                <div key={dateKey} onClick={() => setSelectedDate(dateKey)} style={{
                  textAlign: "center", padding: "8px 0", borderRadius: 10, cursor: "pointer", position: "relative",
                  background: isSelected ? "linear-gradient(135deg, #F97316, #FB923C)" : isToday ? "#FFF0EB" : "white",
                  color: isSelected ? "white" : isPast ? "#9CA3AF" : "#1F2937",
                  border: isToday && !isSelected ? "2px solid #F97316" : "1px solid #E5E7EB",
                  fontWeight: isToday || isSelected ? 800 : 600, fontSize: 13
                }}>
                  {d}
                  {hasPlans && <div style={{ position: "absolute", bottom: 3, left: "50%", transform: "translateX(-50%)", width: 5, height: 5, borderRadius: "50%", background: isSelected ? "white" : "#F97316" }} />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Selected date detail */}
        <div style={{ padding: "0 20px 12px" }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#1F2937", marginBottom: 8 }}>
            {selectedDate === todayKey ? "Today" : new Date(selectedDate + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
            <span style={{ fontSize: 12, fontWeight: 600, color: "#6B7280", marginLeft: 8 }}>{selectedActivities.length} {selectedActivities.length === 1 ? "activity" : "activities"}</span>
          </div>

          {selectedActivities.length === 0 ? (
            <div style={{ padding: "20px", textAlign: "center", background: "white", borderRadius: 14, border: "1px solid #E5E7EB" }}>
              <div style={{ fontSize: 28, marginBottom: 6 }}>📅</div>
              <div style={{ fontSize: 12, color: "#6B7280" }}>Nothing planned yet</div>
              <div onClick={closeCalendar} style={{ display: "inline-block", marginTop: 8, padding: "6px 16px", background: "linear-gradient(135deg, #F97316, #FB923C)", color: "white", borderRadius: 10, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Browse Activities</div>
            </div>
          ) : (
            selectedActivities.map(item => (
              <div key={item.id} style={{ padding: "10px 14px", background: "white", borderRadius: 14, border: "1px solid #E5E7EB", marginBottom: 6, display: "flex", alignItems: "center", gap: 10 }}>
                
                <div style={{ flex: 1 }} onClick={() => { closeCalendar(); setTimeout(() => openDetail(item), 50); }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1F2937", cursor: "pointer" }}>{item.name}</div>
                  <div style={{ fontSize: 11, color: "#6B7280" }}>{item.time || item.day} · {item.location}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: item.free ? "#166534" : "#F97316" }}>{item.price}</span>
                  <div onClick={() => removeFromCalendar(item.id, selectedDate)} style={{ width: 26, height: 26, borderRadius: "50%", background: "#FFF0EB", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 12 }}>✕</div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Activity Passport */}
        <div style={{ padding: "0 20px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#1F2937" }}>🏆 Activity Passport</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#166534" }}>{passport.length} visited</div>
          </div>

          {passport.length === 0 ? (
            <div style={{ padding: "20px", textAlign: "center", background: "white", borderRadius: 14, border: "1px solid #E5E7EB" }}>
              <div style={{ fontSize: 28, marginBottom: 6 }}>🏆</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1F2937", marginBottom: 4 }}>Start collecting!</div>
              <div style={{ fontSize: 11, color: "#6B7280" }}>Tap "Been here?" on activities your family has tried</div>
            </div>
          ) : (
            <>
              {/* Progress by type */}
              {(() => {
                const visitedItems = passport.map(id => listings.find(l => l.id === id)).filter(Boolean);
                const typeCounts = {};
                visitedItems.forEach(v => { typeCounts[v.type] = (typeCounts[v.type] || 0) + 1; });
                const typeTotal = {};
                listings.forEach(l => { typeTotal[l.type] = (typeTotal[l.type] || 0) + 1; });
                return (
                  <div style={{ marginBottom: 10 }}>
                    {Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                      <div key={type} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#1F2937", width: 90, flexShrink: 0 }}>{type}</div>
                        <div style={{ flex: 1, height: 8, background: "#E5E7EB", borderRadius: 4, overflow: "hidden" }}>
                          <div style={{ width: `${Math.min(100, (count / (typeTotal[type] || 1)) * 100)}%`, height: "100%", background: "linear-gradient(90deg, #166534, #86EFAC)", borderRadius: 4 }} />
                        </div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#166534", width: 36, textAlign: "right" }}>{count}/{typeTotal[type] || 0}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Sticker collection */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                {passport.map(id => {
                  const item = listings.find(l => l.id === id);
                  if (!item) return null;
                  return (
                    <div key={id} onClick={() => { closeCalendar(); setTimeout(() => openDetail(item), 50); }} style={{ textAlign: "center", padding: "8px 4px", background: "white", borderRadius: 12, border: "1px solid #E5E7EB", cursor: "pointer" }}>
                      
                      <div style={{ fontSize: 8, fontWeight: 700, color: "#1F2937", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                      <div style={{ fontSize: 7, color: "#166534", fontWeight: 600 }}>✓ Visited</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div style={{ padding: "8px 20px 24px", textAlign: "center" }}>
          <div onClick={closeCalendar} style={{ display: "inline-block", padding: "10px 24px", background: "linear-gradient(135deg, #F97316, #FB923C)", color: "white", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Browse Activities to Add More</div>
        </div>
      </div>
    );
  }

  if (selected) {
    return (
      <div style={{ maxWidth: 480, margin: "0 auto", background: "#F9FAFB", minHeight: "100vh", fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif", color: "#1F2937", overflowX: "hidden" }}>
        <DetailView item={selected} onBack={closeDetail} userLoc={userLoc} reviews={reviews} onAddReview={addReview} isFav={favourites.includes(selected.id)} onToggleFav={toggleFavourite} onAddToCalendar={addToCalendar} onRemoveFromCalendar={removeFromCalendar} calendarPlan={calendarPlan} isVisited={passport.includes(selected.id)} onToggleVisited={togglePassport} tips={tips[selected.id] || []} onAddTip={addTip} allListings={listings} onSelectListing={openDetail} />
      </div>
    );
  }

  const Chip = ({ active, onClick, children, color = "#374151", activeBg = "#6050F0" }) => (
    <div onClick={() => { if (navigator.vibrate) navigator.vibrate(8); onClick(); }} style={{ flexShrink: 0, padding: "8px 14px", borderRadius: 20, fontSize: 13, fontWeight: 600, background: active ? activeBg : "#F3F4F6", color: active ? "white" : color, border: `1px solid ${active ? activeBg : "#E5E7EB"}`, cursor: "pointer", whiteSpace: "nowrap", minHeight: 40, display: "flex", alignItems: "center", transition: "all 0.18s ease" }}>{children}</div>
  );

  // SEO landing page route
  if (window.location.pathname === "/things-to-do-with-kids-in-ealing") {
    return <EalingSEOPage listings={listings} onActivityClick={(item) => { window.history.pushState({}, "", "/"); openDetail(item); }} />;
  }

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", background: "#F9FAFB", minHeight: "100vh", fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif", color: "#1F2937", overflowX: "hidden" }}>
      {/* HEADER */}
      <div style={{ padding: showScrollTop ? "8px 20px 4px" : "12px 20px 6px", position: "sticky", top: 0, zIndex: 100, background: "#F9FAFB", borderBottom: "1px solid #E5E7EB", transition: "padding 0.2s" }}>
        {!showScrollTop ? (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div onClick={() => { window.scrollTo({ top: 0, behavior: "smooth" }); setShowSuggest(false); setSelected(null); }} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <div style={{ width: 48, height: 48, overflow: "hidden", flexShrink: 0, borderRadius: 12, border: "2px solid #E5E7EB" }}><BrandBear size={48} /></div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.3 }}><span style={{ color: "#6050F0" }}>LITTLE</span><span style={{ color: "#F97316" }}>locals</span></div>
                </div>
              </div>
            </div>
            <div style={{ marginTop: 6, marginLeft: 58 }}>
              {(() => {
                const hr = new Date().getHours();
                const greeting = hr < 12 ? "Good morning, Ealing parents" : hr < 17 ? "Afternoon ideas for Ealing families" : "Planning tomorrow in Ealing?";
                return <div style={{ fontSize: 13, fontWeight: 600, color: "#6050F0", marginBottom: 6, letterSpacing: 0.1 }}>{greeting}</div>;
              })()}
              <div style={{ fontSize: 26, fontWeight: 800, color: "#1F2937", lineHeight: 1.2, marginBottom: 6, letterSpacing: -0.5 }}>What should we do today?</div>
              <div style={{ fontSize: 15, color: "#4B5563", marginBottom: 10, fontWeight: 400 }}>Discover the best kids activities near you in {areaFilter !== "All Areas" ? areaFilter : "Ealing"}.</div>
              {(() => {
                const seed = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
                const n = 7 + (seed % 6);
                return <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#374151", background: "#FFF7ED", border: "1px solid #FED7AA", padding: "5px 12px", borderRadius: 999, marginBottom: 16, fontWeight: 600 }}>🔥 {n} parents exploring today</div>;
              })()}
            </div>
          </>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} style={{ width: 32, height: 32, overflow: "hidden", flexShrink: 0, borderRadius: 8, border: "1.5px solid #E5E7EB", cursor: "pointer" }}><BrandBear size={32} /></div>
            <div style={{ flex: 1, minWidth: 0, background: "white", borderRadius: 10, padding: "6px 12px", display: "flex", alignItems: "center", gap: 6, border: "1px solid #E5E7EB" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search activities..." style={{ border: "none", outline: "none", fontSize: 12, flex: 1, minWidth: 0, background: "transparent", fontFamily: "inherit" }} />
            </div>
            <div onClick={() => setShowMoreFilters(!showMoreFilters)} style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid #E5E7EB", background: showMoreFilters ? "#1F2937" : "white", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={showMoreFilters ? "white" : "#374151"} strokeWidth="2.5" strokeLinecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="16" y2="12"/><line x1="4" y1="18" x2="12" y2="18"/></svg>
            </div>
          </div>
        )}
      </div>

      {/* Pull to refresh indicator */}
      {pullRefreshing && (
        <div style={{ textAlign: "center", padding: "8px 0" }}>
          <div style={{ display: "inline-block", width: 20, height: 20, border: "2px solid #E5E7EB", borderTopColor: "#F97316", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Loading spinner on first load */}
      {isLoading && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 20px", gap: 12 }}>
          <div style={{ width: 36, height: 36, border: "3px solid #E5E7EB", borderTopColor: "#F97316", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          <div style={{ fontSize: 13, color: "#6B7280", fontWeight: 600 }}>Loading activities...</div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {!isLoading && <>

      {/* Suggest Submitted Confirmation */}
      {suggestSubmitted && (
        <div style={{ margin: "6px 20px 8px", padding: "12px 16px", background: "#F0F7F0", borderRadius: 14, textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#166534" }}>Activity submitted!</div>
          <div style={{ fontSize: 11, color: "#6B7280", marginTop: 2 }}>We'll review it and add it to LITTLElocals soon</div>
        </div>
      )}

      {/* Suggest Activity Form — inline when open */}
      {showSuggest && (
        <div style={{ margin: "6px 20px 10px" }}>
          <div style={{ background: "white", borderRadius: 16, padding: 18, border: "1px solid #E5E7EB", boxShadow: "0 4px 16px rgba(92,75,107,0.06)" }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 2, color: "#1F2937" }}>Know a great activity we missed?</div>
            <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 14 }}>Help other Ealing parents discover it. Free to add — built by local parents.</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#4B5563", marginBottom: 4 }}>Activity Name *</div>
            <input value={suggestForm.name} onChange={e => setSuggestForm(p => ({...p, name: e.target.value}))} placeholder="e.g. Tiny Tots Music Class" style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #E5E7EB", fontSize: 13, fontFamily: "inherit", marginBottom: 10, boxSizing: "border-box", outline: "none" }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#4B5563", marginBottom: 4 }}>Type *</div>
                <select value={suggestForm.type} onChange={e => setSuggestForm(p => ({...p, type: e.target.value}))} style={{ width: "100%", padding: "10px 8px", borderRadius: 10, border: "1px solid #E5E7EB", fontSize: 12, fontFamily: "inherit", background: "white", boxSizing: "border-box" }}>
                  {Object.keys(typeColors).map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#4B5563", marginBottom: 4 }}>City *</div>
                <select value={suggestForm.city} onChange={e => setSuggestForm(p => ({...p, city: e.target.value, location: ""}))} style={{ width: "100%", padding: "10px 8px", borderRadius: 10, border: "1px solid #E5E7EB", fontSize: 12, fontFamily: "inherit", background: "white", boxSizing: "border-box" }}>
                  {Object.keys(cityGroups).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div style={{ position: "relative" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#4B5563", marginBottom: 4 }}>Area *</div>
                <input value={suggestForm.location} onChange={e => setSuggestForm(p => ({...p, location: e.target.value}))} placeholder="Type area name..." style={{ width: "100%", padding: "10px 8px", borderRadius: 10, border: "1px solid #E5E7EB", fontSize: 12, fontFamily: "inherit", background: "white", boxSizing: "border-box", outline: "none" }} onFocus={e => e.target.setAttribute("data-open","1")} onBlur={e => setTimeout(() => e.target.removeAttribute("data-open"), 200)} />
                {suggestForm.location && suggestForm.location.length > 0 && (() => {
                  const areas = (cityGroups[suggestForm.city] || []).filter(a => !a.includes("/") && a !== "Hillingdon-wide" && a.toLowerCase().includes(suggestForm.location.toLowerCase()));
                  const exactMatch = (cityGroups[suggestForm.city] || []).some(a => a.toLowerCase() === suggestForm.location.toLowerCase());
                  if (exactMatch || areas.length === 0) return null;
                  return <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "white", border: "1px solid #E5E7EB", borderRadius: 10, marginTop: 2, maxHeight: 150, overflowY: "auto", zIndex: 10, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
                    {areas.slice(0, 8).map(a => <div key={a} onMouseDown={() => setSuggestForm(p => ({...p, location: a}))} style={{ padding: "8px 10px", fontSize: 12, cursor: "pointer", borderBottom: "1px solid #E5E7EB" }}>{a}</div>)}
                  </div>;
                })()}
              </div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#4B5563", marginBottom: 4 }}>Venue / Address *</div>
            <input value={suggestForm.venue} onChange={e => setSuggestForm(p => ({...p, venue: e.target.value}))} placeholder="e.g. St Mary's Church Hall, High St, HA4 7AY" style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #E5E7EB", fontSize: 13, fontFamily: "inherit", marginBottom: 10, boxSizing: "border-box", outline: "none" }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
              <div><div style={{ fontSize: 11, fontWeight: 600, color: "#4B5563", marginBottom: 4 }}>Ages</div><input value={suggestForm.ages} onChange={e => setSuggestForm(p => ({...p, ages: e.target.value}))} placeholder="0–5yrs" style={{ width: "100%", padding: "10px 8px", borderRadius: 10, border: "1px solid #E5E7EB", fontSize: 12, fontFamily: "inherit", boxSizing: "border-box", outline: "none" }} /></div>
              <div><div style={{ fontSize: 11, fontWeight: 600, color: "#4B5563", marginBottom: 4 }}>Day(s)</div><input value={suggestForm.day} onChange={e => setSuggestForm(p => ({...p, day: e.target.value}))} placeholder="Mondays" style={{ width: "100%", padding: "10px 8px", borderRadius: 10, border: "1px solid #E5E7EB", fontSize: 12, fontFamily: "inherit", boxSizing: "border-box", outline: "none" }} /></div>
              <div><div style={{ fontSize: 11, fontWeight: 600, color: "#4B5563", marginBottom: 4 }}>Time</div><input value={suggestForm.time} onChange={e => setSuggestForm(p => ({...p, time: e.target.value}))} placeholder="10:00 AM" style={{ width: "100%", padding: "10px 8px", borderRadius: 10, border: "1px solid #E5E7EB", fontSize: 12, fontFamily: "inherit", boxSizing: "border-box", outline: "none" }} /></div>
              <div><div style={{ fontSize: 11, fontWeight: 600, color: "#4B5563", marginBottom: 4 }}>Price</div><input value={suggestForm.price} onChange={e => setSuggestForm(p => ({...p, price: e.target.value}))} placeholder="£8" style={{ width: "100%", padding: "10px 8px", borderRadius: 10, border: "1px solid #E5E7EB", fontSize: 12, fontFamily: "inherit", boxSizing: "border-box", outline: "none" }} /></div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#4B5563", marginBottom: 4 }}>Description</div>
            <textarea value={suggestForm.description} onChange={e => setSuggestForm(p => ({...p, description: e.target.value}))} placeholder="Tell us what makes this activity great..." rows={3} style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #E5E7EB", fontSize: 13, fontFamily: "inherit", marginBottom: 10, boxSizing: "border-box", resize: "vertical", outline: "none" }} />
            <div style={{ borderTop: "1px solid #E5E7EB", paddingTop: 12, marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Your Details</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <input value={suggestForm.submitterName} onChange={e => setSuggestForm(p => ({...p, submitterName: e.target.value}))} placeholder="Your name *" style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #E5E7EB", fontSize: 12, fontFamily: "inherit", boxSizing: "border-box", outline: "none" }} />
                <input value={suggestForm.submitterEmail} onChange={e => setSuggestForm(p => ({...p, submitterEmail: e.target.value}))} placeholder="Email (optional)" style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #E5E7EB", fontSize: 12, fontFamily: "inherit", boxSizing: "border-box", outline: "none" }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={closeSuggest} style={{ flex: 1, padding: 12, borderRadius: 10, border: "1px solid #E5E7EB", background: "white", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", color: "#4B5563" }}>Cancel</button>
              <button onClick={submitSuggestion} disabled={!suggestForm.name.trim() || !suggestForm.venue.trim() || !suggestForm.submitterName.trim() || !suggestForm.location} style={{ flex: 1.5, padding: 12, borderRadius: 10, border: "none", background: suggestForm.name.trim() && suggestForm.venue.trim() && suggestForm.submitterName.trim() && suggestForm.location ? "linear-gradient(135deg, #F97316, #FB923C)" : "#E5E7EB", color: "white", fontSize: 13, fontWeight: 700, cursor: suggestForm.name.trim() && suggestForm.venue.trim() && suggestForm.submitterName.trim() && suggestForm.location ? "pointer" : "default", fontFamily: "inherit" }}>Submit for Review</button>
            </div>
          </div>
        </div>
      )}

      {/* Location modal — first visit only */}
      {locStatus === "idle" && (() => { try { return !localStorage.getItem("ll_loc_asked"); } catch(e) { return false; } })() && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "white", borderRadius: 20, padding: "28px 24px", maxWidth: 320, width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#1F2937", marginBottom: 6 }}>Enable location?</div>
            <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 20, lineHeight: 1.5 }}>Allow location access to show activities closest to you.</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { localStorage.setItem("ll_loc_asked", "1"); setLocStatus("dismissed"); }} style={{ flex: 1, padding: "12px 0", borderRadius: 12, border: "1px solid #E5E7EB", background: "white", fontSize: 13, fontWeight: 600, color: "#6B7280", cursor: "pointer", fontFamily: "inherit" }}>Not now</button>
              <button onClick={() => { localStorage.setItem("ll_loc_asked", "1"); requestLocation(); }} style={{ flex: 1, padding: "12px 0", borderRadius: 12, border: "none", background: "#F97316", fontSize: 13, fontWeight: 700, color: "white", cursor: "pointer", fontFamily: "inherit" }}>Allow</button>
            </div>
          </div>
        </div>
      )}

      {/* Search + Filters bar */}
      <div style={{ margin: "8px 20px 6px", display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ flex: 1, background: "white", borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, border: "1px solid #E5E7EB" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search activities..." style={{ border: "none", outline: "none", fontSize: 13, flex: 1, background: "transparent", fontFamily: "inherit", minWidth: 0 }} />
        </div>
        <div onClick={() => setShowMoreFilters(!showMoreFilters)} style={{ padding: "10px 14px", background: showMoreFilters ? "#1F2937" : "#FFFFFF", borderRadius: 12, border: showMoreFilters ? "none" : "1px solid #E5E7EB", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, flexShrink: 0, minHeight: 44, transition: "all 0.18s ease" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={showMoreFilters ? "white" : "#374151"} strokeWidth="2.5" strokeLinecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="16" y2="12"/><line x1="4" y1="18" x2="12" y2="18"/></svg>
          <span style={{ fontSize: 12, fontWeight: 600, color: showMoreFilters ? "white" : "#374151" }}>Filters</span>
        </div>
      </div>

      {/* Time filter pills */}
      {!search && (
        <div style={{ padding: "0 20px 8px", display: "flex", gap: 6 }}>
          {[
            { label: "Today", value: "today", count: todayCount },
            { label: "This weekend", value: "weekend", count: weekendCount },
            { label: "This week", value: "week", count: weekCount },
          ].map(({ label, value, count }) => {
            const active = dayFilter === value;
            const zero = count === 0;
            return (
              <span
                key={value}
                onClick={() => { setDayFilter(value); setPage(1); }}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  fontSize: 12, fontWeight: active ? 700 : 500,
                  padding: "5px 14px", borderRadius: 20, cursor: "pointer",
                  background: active ? "#6050F0" : "transparent",
                  color: active ? "white" : zero ? "#C0C0C0" : "#6B7280",
                  border: active ? "none" : "1px solid #E5E7EB",
                  transition: "all 0.15s ease",
                  whiteSpace: "nowrap",
                  opacity: zero && !active ? 0.6 : 1,
                }}
              >
                {label}
                <span style={{
                  fontSize: 10, fontWeight: 600,
                  color: active ? "rgba(255,255,255,0.7)" : "#B0B0B0",
                  background: active ? "rgba(255,255,255,0.15)" : "#F3F4F6",
                  padding: "1px 5px", borderRadius: 8, lineHeight: 1.4
                }}>{count}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* Expandable filter panel */}
      {showMoreFilters && (
        <div style={{ margin: "0 20px 10px", background: "white", borderRadius: 16, padding: 16, border: "1px solid #E5E7EB" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Area</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            <Chip active={areaFilter === "All Areas"} onClick={() => { setAreaFilter("All Areas"); setPage(1); }} activeBg="#6050F0">All</Chip>
            {["Ealing", "Acton", "Chiswick", "Hanwell", "Northfields", "Ruislip", "Eastcote", "Uxbridge"].map(area => (
              <Chip key={area} active={areaFilter === area} onClick={() => { setAreaFilter(areaFilter === area ? "All Areas" : area); setPage(1); }} activeBg="#6050F0">{area}</Chip>
            ))}
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Day</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            <Chip active={dayFilter === "today"} onClick={() => { setDayFilter("today"); setPage(1); }} activeBg="#6050F0">Today</Chip>
            {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d, i) => (
              <Chip key={d} active={dayFilter === String(i === 6 ? 0 : i + 1)} onClick={() => { setDayFilter(String(i === 6 ? 0 : i + 1)); setPage(1); }} activeBg="#6050F0">{d}</Chip>
            ))}
            <Chip active={dayFilter === "all"} onClick={() => { setDayFilter("all"); setPage(1); }} activeBg="#6050F0">All</Chip>
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Type</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            <Chip active={weatherMode === "rainy"} onClick={() => setWeatherMode(weatherMode === "rainy" ? "all" : "rainy")} activeBg="#6050F0">🌧️ Indoor</Chip>
            <Chip active={weatherMode === "sunny"} onClick={() => setWeatherMode(weatherMode === "sunny" ? "all" : "sunny")} activeBg="#6050F0">☀️ Outdoor</Chip>
            <Chip active={freeOnly} onClick={() => setFreeOnly(!freeOnly)} activeBg="#6050F0">Free</Chip>
            <Chip active={napFilter === "morning"} onClick={() => setNapFilter(napFilter === "morning" ? "all" : "morning")} activeBg="#6050F0">Morning</Chip>
            <Chip active={napFilter === "afternoon"} onClick={() => setNapFilter(napFilter === "afternoon" ? "all" : "afternoon")} activeBg="#6050F0">Afternoon</Chip>
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Category</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            {Object.keys(typeColors).map(t => (
              <Chip key={t} active={typeFilter === t} onClick={() => setTypeFilter(typeFilter === t ? "All Types" : t)} activeBg="#6050F0">{t}</Chip>
            ))}
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Age</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            {[{v:"all",l:"All"},{v:"0-1",l:"0–1"},{v:"1-2",l:"1–2"},{v:"2-4",l:"2–4"},{v:"4-7",l:"4–7"},{v:"7+",l:"7+"}].map(a => (
              <Chip key={a.v} active={ageFilter === a.v} onClick={() => setAgeFilter(a.v)} activeBg="#6050F0">{a.l}</Chip>
            ))}
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Region</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            {[{v:"All",l:"All UK"},{v:"London",l:"London"},{v:"Hertfordshire",l:"Hertfordshire"},{v:"Buckinghamshire",l:"Buckinghamshire"},{v:"Essex",l:"Essex"},{v:"Birmingham",l:"Birmingham"},{v:"Manchester",l:"Manchester"},{v:"Leeds",l:"Leeds"},{v:"Liverpool",l:"Liverpool"}].map(c => (
              <Chip key={c.v} active={cityFilter === c.v} onClick={() => { setCityFilter(c.v); setAreaFilter("All Areas"); setPage(1); }} activeBg="#6050F0">{c.l}</Chip>
            ))}
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Sort</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            <Chip active={sortBy === "mixed"} onClick={() => setSortBy("mixed")} activeBg="#6050F0">Mixed</Chip>
            <Chip active={sortBy === "nearest"} onClick={() => { setSortBy("nearest"); if (locStatus === "idle" || locStatus === "dismissed") requestLocation(); }} activeBg="#6050F0">Nearest</Chip>
            <Chip active={sortBy === "price-low"} onClick={() => setSortBy("price-low")} activeBg="#6050F0">Price: Low</Chip>
            <Chip active={sortBy === "free-first"} onClick={() => setSortBy("free-first")} activeBg="#6050F0">Free first</Chip>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {favourites.length > 0 && <Chip active={showFavourites} onClick={() => { setShowFavourites(!showFavourites); setPage(1); }} activeBg="#F97316">Saved ({favourites.length})</Chip>}
            <Chip active={false} onClick={openCalendar}>My Plans {calendarTotal > 0 ? `(${calendarTotal})` : ""}</Chip>
            <Chip active={mapView} onClick={() => { setMapView(!mapView); if (!mapView && locStatus === "idle") requestLocation(); if (!mapView) setAreaFilter("All Areas"); }} activeBg="#6050F0">Map</Chip>
          </div>
        </div>
      )}

      {/* Quick filters + count row */}
      <div style={{ padding: "0 20px 4px", borderTop: "1px solid #F3F4F6", paddingTop: 10 }}>
        <div style={{ display: "flex", gap: 7, marginBottom: 8 }}>
          {[
            { label: "☀️ Outdoor", action: () => { setWeatherMode(weatherMode === "sunny" ? "all" : "sunny"); setPage(1); }, active: weatherMode === "sunny", count: (filtered||[]).filter(l=>!l.indoor).length },
            { label: "🌧️ Indoor",  action: () => { setWeatherMode(weatherMode === "rainy" ? "all" : "rainy"); setPage(1); }, active: weatherMode === "rainy", count: (filtered||[]).filter(l=>l.indoor).length },
            { label: "💰 Free",    action: () => { setFreeOnly(!freeOnly); setPage(1); }, active: freeOnly, count: (filtered||[]).filter(l=>l.free).length },
            { label: "📅 Events",  action: () => { setEventsOnly(!eventsOnly); setPage(1); }, active: eventsOnly, count: (listings||[]).filter(l=>l.isEvent && (!l.eventDate || new Date(l.eventDate) >= new Date())).length },
            { label: "✨ Popular", action: () => { setSortBy(sortBy === "popular" ? "mixed" : "popular"); setPage(1); }, active: sortBy === "popular", count: (filtered||[]).filter(l=>l.popular).length },
            { label: "🚗 Journey", action: () => { setWorthJourney(!worthJourney); setPage(1); }, active: worthJourney, count: (listings||[]).filter(l=>l.worthJourney).length },
          ].map(({ label, action, active }) => (
            <span
              key={label}
              onClick={action}
              style={{
                flex: 1, textAlign: "center",
                fontSize: 12, fontWeight: active ? 700 : 500,
                padding: "6px 0", borderRadius: 20, cursor: "pointer",
                background: active ? "#F97316" : "white",
                color: active ? "white" : "#6B7280",
                border: active ? "none" : "1px solid #EBEBEB",
                whiteSpace: "nowrap",
              }}
            >{label}</span>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <span style={{ fontSize: 11, color: "#B0B0B0", fontWeight: 400 }}>{filtered.length} {dayFilter === "today" ? "things to do today" : dayFilter === "weekend" ? "activities this weekend" : "activities"} in {areaFilter !== "All Areas" ? areaFilter : "Ealing"}</span>
            {dayFilter === "today" && (() => {
              const LOCAL_AREAS = ["Ealing","Hanwell","West Ealing","North Ealing","South Ealing","Acton","Northfields","Chiswick","Brentford","Greenford","Northolt","Southall","Ruislip","Eastcote","Uxbridge","Pitshanger","Wembley","Hounslow","Isleworth","Twickenham","Richmond","Hayes"];
              const localCount = listings.filter(l => LOCAL_AREAS.some(a => (l.location || "").includes(a))).length;
              return <div style={{ fontSize: 10, color: "#C8C8C8", fontWeight: 400, marginTop: 1 }}>{localCount} things to do around Ealing</div>;
            })()}
          </div>
          {(cityFilter !== "All" || dayFilter !== "today" || weatherMode !== "all" || napFilter !== "all" || freeOnly || ageFilter !== "all" || typeFilter !== "All Types" || areaFilter !== "All Areas" || showFavourites) && (
            <span onClick={() => { setCityFilter("All"); setDayFilter("today"); setWeatherMode("all"); setNapFilter("all"); setFreeOnly(false); setEventsOnly(false); setWorthJourney(false); setAgeFilter("all"); setTypeFilter("All Types"); setAreaFilter("All Areas"); setSearch(""); setSortBy("mixed"); setPage(1); setShowFavourites(false); }} style={{ fontSize: 11, color: "#F97316", fontWeight: 600, cursor: "pointer" }}>Clear all</span>
          )}
        </div>
      </div>

      {/* Map View */}
      {mapView && (
        <div style={{ margin: "0 20px 4px" }}>
          <div style={{ fontSize: 10, color: "#6B7280", marginBottom: 4, textAlign: "right" }}>{filtered.filter(i => i.lat && i.lng).length} activities on map</div>
          <MapView filtered={filtered} userLoc={userLoc} onSelect={openDetail} areaFilter={areaFilter} />
        </div>
      )}

      {/* Listings — paginated */}
      {!mapView && <>

      {/* === Continue where you left off (slim banner, outside feed limit) === */}
      {page === 1 && !search && !showFavourites && dayFilter === "today" && (() => {
        try {
          const lv = JSON.parse(localStorage.getItem("ll_lastViewedActivity") || "null");
          if (!lv || !lv.id || (Date.now() - lv.timestamp) > 7 * 24 * 60 * 60 * 1000) return null;
          const lvItem = listings.find(a => a.id === lv.id);
          if (!lvItem) return null;
          const tc = typeColors[lvItem.type] || { bg: "#eee", color: "#333" };
          return (
            <div style={{ padding: "8px 20px 0" }}>
              <div onClick={() => openDetail(lvItem)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#FAFAFA", borderRadius: 10, border: "1px solid #F0F0F0", cursor: "pointer" }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, background: `linear-gradient(135deg, ${tc.bg}, ${tc.bg}cc)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 13, fontWeight: 800, color: tc.color || "#666" }}>{(lvItem.type || "A").charAt(0)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: "#B0B0B0", marginBottom: 1 }}>Continue exploring · You recently viewed:</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lvItem.name}</div>
                </div>
                <span style={{ fontSize: 11, color: "#C0C0C0", flexShrink: 0 }}>→</span>
              </div>
              {(() => {
                const visited = passport.length;
                if (visited === 0) return null;
                const area = areaFilter !== "All Areas" ? areaFilter : "Ealing";
                const msg = visited >= 10
                  ? `🎉 Local Explorer – you've tried ${visited} places in ${area}`
                  : `You've explored ${visited} place${visited !== 1 ? "s" : ""} in ${area}`;
                return <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 6, paddingLeft: 2 }}>{msg}</div>;
              })()}
            </div>
          );
        } catch { return null; }
      })()}

      {/* === CURATED HOMEPAGE SECTIONS (page 1, default view only) === */}
      {page === 1 && !search && !showFavourites && dayFilter === "today" && (() => {
        const area = areaFilter !== "All Areas" ? areaFilter : "Ealing";
        const shownIds = new Set();

        // Also add featured providers and continue-where-left-off to shown
        const fp = listings.find(a => a.featuredProvider);
        if (fp) shownIds.add(fp.id);
        const hb = listings.find(a => a.name && a.name.toLowerCase().includes("hartbeeps"));
        if (hb) shownIds.add(hb.id);

        // Helper: distance sort
        const areaCenters = { "Ealing": { lat: 51.5139, lng: -0.3048 }, "Ruislip": { lat: 51.5714, lng: -0.4213 }, "Eastcote": { lat: 51.5762, lng: -0.3962 }, "Uxbridge": { lat: 51.5461, lng: -0.4761 }, "Ickenham": { lat: 51.5653, lng: -0.4457 }, "Hillingdon": { lat: 51.5341, lng: -0.4494 } };
        const locRef = userLoc || areaCenters[areaFilter] || areaCenters["Ealing"];
        const getDist = (a) => a.lat && locRef ? Math.sqrt(Math.pow((a.lat - locRef.lat) * 111, 2) + Math.pow((a.lng - locRef.lng) * 111 * Math.cos(locRef.lat * Math.PI / 180), 2)) : 999;

        // --- SECTION 1: Today in {Area} ---
        const todayCandidates = filtered.filter(a => isOnToday(a));

        // Sort today candidates by quality score for curated feel
        const getTodayScore = (a) => {
          let s = 0;
          if ((a.images && a.images.length > 0) || a.logo || a.imageUrl) s += 10;
          if (a.description && a.description.length > 30) s += 2;
          if (a.time && a.time.length > 3) s += 1;
          if (a.website || a.trialLink) s += 1;
          if (a.popular || a.featuredProvider) s += 1;
          return s;
        };
        const sortedTodayCandidates = [...todayCandidates].sort((a, b) => getTodayScore(b) - getTodayScore(a));

        // Mix by category (max 1 per type in first 6-8 slots)
        const todayTypes = [...new Set(sortedTodayCandidates.map(a => a.type))];
        const todayBuckets = {};
        todayTypes.forEach(t => { todayBuckets[t] = sortedTodayCandidates.filter(a => a.type === t); });
        const todayMixed = [];
        let ts = sortedTodayCandidates.length + 10;
        while (todayMixed.length < sortedTodayCandidates.length && ts-- > 0) {
          for (const t of todayTypes) {
            if (todayBuckets[t].length > 0) todayMixed.push(todayBuckets[t].shift());
          }
        }
        const TODAY_LIMIT = 4;
        const todayRaw = todayMixed.length > 0 ? todayMixed : sortedTodayCandidates;
        // Deduplicate by exact name
        const todaySeenNames = new Set();
        const todayListFull = todayRaw.filter(a => {
          const name = (a.name || "").toLowerCase().trim();
          if (todaySeenNames.has(name)) return false;
          todaySeenNames.add(name);
          return true;
        });
        const todayList = todayListFull.slice(0, TODAY_LIMIT);
        todayListFull.forEach(a => shownIds.add(a.id));

        // Human-relevant signals — standardised 3 variants only
        const getTodaySignal = (item, idx, clicks) => {
          if (item.popular || item.featuredProvider || clicks >= 8) return "⭐ Popular with parents";
          if (clicks >= 3) return "🔥 Trending today";
          if (item.verified) return "❤️ Saved by parents";
          return null;
        };

        // --- SECTION 2: From your saved ---
        const savedList = favourites.length > 0
          ? listings.filter(a => favourites.includes(a.id) && !shownIds.has(a.id)).slice(0, 1)
          : [];
        savedList.forEach(a => shownIds.add(a.id));

        // --- SECTION 3: This weekend ---
        const halfDay = Math.floor(Date.now() / (12 * 60 * 60 * 1000));
        const sRand = (i) => { let x = Math.sin(halfDay * 9301 + i * 49297) * 49297; return x - Math.floor(x); };
        const popularList = listings.filter(a => !shownIds.has(a.id) && isOnWeekend(a))
          .sort((a, b) => {
            const score = x => (x.popular ? 3 : 0) + (x.verified ? 2 : 0) + (clickCounts[x.id] || 0);
            return score(b) - score(a);
          }).slice(0, 3);
        popularList.forEach(a => shownIds.add(a.id));

        // --- SECTION 4: Loved by Ealing parents ---
        const lovedList = filtered.filter(a => (a.verified || a.popular) && !shownIds.has(a.id))
          .sort((a, b) => (clickCounts[b.id] || 0) - (clickCounts[a.id] || 0))
          .slice(0, 3);
        lovedList.forEach(a => shownIds.add(a.id));

        shownIdsRef.current = shownIds;

        return (<>
          {/* Today near you — closest 1-2 activities */}
          {userLoc && (() => {
            const nearbyToday = [...todayCandidates]
              .filter(a => a.lat && a.lng)
              .sort((a, b) => getDist(a) - getDist(b))
              .slice(0, 2);
            if (nearbyToday.length === 0) return null;
            return (
              <div style={{ padding: "12px 20px 0" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 8 }}>📍 Near you today</div>
                <div style={{ display: "flex", gap: 8, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 4 }}>
                  {nearbyToday.map(item => {
                    const dist = getDist(item);
                    const walkMin = dist < 50 ? Math.round(dist * 1.60934 * 12) : null;
                    const tc = typeColors[item.type] || { bg: "#F3F4F6", color: "#374151" };
                    return (
                      <div key={"nearby-" + item.id} onClick={() => openDetail(item)} style={{ flexShrink: 0, width: 160, background: "white", borderRadius: 12, border: "1px solid #E5E7EB", padding: "10px 12px", cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#1F2937", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                        <div style={{ fontSize: 10, color: "#6B7280", marginBottom: 4 }}>{item.type}</div>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {walkMin !== null && <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 5, background: "#FFF7ED", color: "#F97316" }}>{walkMin < 2 ? "Nearby" : walkMin + " min walk"}</span>}
                          <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 5, background: "#ECFDF5", color: "#166534" }}>Open today</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Quick ideas for today — always 3: popular, nearby, free */}
          {(() => {
            const locRef2 = userLoc || areaCenters[areaFilter] || areaCenters["Ealing"];
            const getDist2 = (a) => a.lat && locRef2 ? Math.sqrt(Math.pow((a.lat-locRef2.lat)*111,2)+Math.pow((a.lng-locRef2.lng)*111*Math.cos(locRef2.lat*Math.PI/180),2)) : 999;
            const popular = sortedTodayCandidates.find(a => a.popular || (clickCounts[a.id]||0) >= 5);
            const nearby = [...sortedTodayCandidates].sort((a,b) => getDist2(a)-getDist2(b)).find(a => a.id !== popular?.id);
            const free = sortedTodayCandidates.find(a => a.free && a.id !== popular?.id && a.id !== nearby?.id);
            const ideas = [
              popular && { item: popular, label: "⭐ Popular today" },
              nearby && { item: nearby, label: "📍 Nearby" },
              free   && { item: free,   label: "💰 Free" },
            ].filter(Boolean).slice(0, 3);
            if (ideas.length === 0) return null;
            return (
              <div style={{ marginTop: 16, padding: "0 20px" }}>
                {(() => {
                  const h = new Date().getHours();
                  const area = areaFilter !== "All Areas" ? areaFilter : "Ealing";
                  if (h >= 5 && h < 12)  return (<><div style={{ fontSize: 14, fontWeight: 800, color: "#111827", marginBottom: 2, letterSpacing: -0.2 }}>🌤 Good morning {area} parents</div><div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 10 }}>Here are a few ideas for today.</div></>);
                  if (h >= 12 && h < 18) return (<><div style={{ fontSize: 14, fontWeight: 800, color: "#111827", marginBottom: 2, letterSpacing: -0.2 }}>☀️ Afternoon ideas for {area} families</div><div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 10 }}>Still looking for something to do today?</div></>);
                  if (h >= 18)           return (<><div style={{ fontSize: 14, fontWeight: 800, color: "#111827", marginBottom: 2, letterSpacing: -0.2 }}>🌙 Planning tomorrow with the kids?</div><div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 10 }}>Here are some ideas around {area}.</div></>);
                  return (<><div style={{ fontSize: 14, fontWeight: 800, color: "#111827", marginBottom: 2, letterSpacing: -0.2 }}>🌙 Late night planning?</div><div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 10 }}>Save some ideas for tomorrow.</div></>);
                })()}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {ideas.map(({ item, label }) => {
                    const tc2 = typeColors[item.type] || { bg: "#F3F4F6", color: "#374151" };
                    const d = getDist(item);
                    const wm = d < 50 ? Math.round(d * 1.60934 * 12) : null;
                    return (
                      <div key={"qi-" + item.id} onClick={() => openDetail(item)}
                        style={{ display: "flex", alignItems: "center", gap: 13, padding: "13px 15px", background: "white", borderRadius: 16, border: "1px solid #EBEBEB", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.06)", transition: "box-shadow 0.15s" }}
                        onTouchStart={e => e.currentTarget.style.boxShadow="0 1px 2px rgba(0,0,0,0.04)"}
                        onTouchEnd={e => e.currentTarget.style.boxShadow="0 2px 8px rgba(0,0,0,0.06)"}
                      >
                        <div style={{ width: 46, height: 46, borderRadius: 13, background: `linear-gradient(135deg, ${tc2.bg}, ${tc2.bg}cc)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 16, fontWeight: 800, color: tc2.color || "#333", position: "relative", overflow: "hidden" }}>
                          {(item.logo || (item.images && item.images[0])) && <img src={item.logo || item.images[0]} alt="" style={{ width: "80%", height: "80%", objectFit: "contain", position: "absolute", top: "10%", left: "10%", borderRadius: "50%" }} onError={e => e.target.style.display="none"} />}
                          {!(item.logo || (item.images && item.images[0])) && (item.type || "A").charAt(0)}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 10, color: "#F97316", fontWeight: 700, marginBottom: 2, letterSpacing: 0.3, textTransform: "uppercase" }}>{label}</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                          <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 1 }}>{item.type}{wm !== null && wm < 60 ? ` · ${wm < 5 ? "Nearby" : wm + " min walk"}` : ""}{item.free ? " · Free" : ""}</div>
                        </div>
                        <span style={{ fontSize: 18, color: "#D1D5DB", flexShrink: 0 }}>›</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Ealing parents are loving these */}
          {(() => {
            const loved = listings
              .filter(l => !l.isEvent && !shownIds.has(l.id) && (l.popular || l.featuredProvider || (clickCounts[l.id]||0) >= 3 || l.verified) && ((l.images && l.images.length > 0) || l.logo || l.imageUrl))
              .sort((a, b) => {
                const sa = (a.popular?3:0)+(a.featuredProvider?2:0)+(clickCounts[a.id]||0)+(a.verified?1:0);
                const sb = (b.popular?3:0)+(b.featuredProvider?2:0)+(clickCounts[b.id]||0)+(b.verified?1:0);
                return sb - sa;
              })
              .slice(0, 3);
            if (loved.length < 2) return null;
            loved.forEach(l => shownIds.add(l.id));
            return (
              <div style={{ marginTop: 28, padding: "0 20px" }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#111827", letterSpacing: "-0.3px", marginBottom: 2 }}>🔥 Ealing parents are loving these</div>
                <div style={{ fontSize: 12, color: "#B0B0B0", marginTop: 3, marginBottom: 14 }}>Popular with local families right now</div>
                {loved.map(item => (
                  <ListingCard key={"loved-"+item.id} item={item} onSelect={openDetail} userLoc={userLoc} isFav={favourites.includes(item.id)} onToggleFav={toggleFavourite} isNew={false} reviews={reviews} areaFilter={areaFilter} isSunny={isSunny} onTrackClick={trackClick} clickCount={clickCounts[item.id]||0} />
                ))}
              </div>
            );
          })()}

          {/* 1. Top things to do today */}
          <div style={{ marginTop: 28, padding: "0 20px" }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#111827", letterSpacing: "-0.3px", marginBottom: 2 }}>Top things to do today in {area}</div>
            {(() => {
              const totalViews = todayList.reduce((sum, a) => sum + (clickCounts[a.id] || 0), 0);
              if (totalViews >= 5) return <div style={{ fontSize: 12, color: "#B0B0B0", marginTop: 3, marginBottom: 14 }}>🔥 {totalViews} Ealing parents viewed this today</div>;
              return <div style={{ fontSize: 12, color: "#B0B0B0", marginTop: 3, marginBottom: 14 }}>Quick ideas parents are choosing today</div>;
            })()}
            {todayList.length === 0 ? (
              <div style={{ padding: "16px 0", textAlign: "center" }}>
                <div style={{ fontSize: 14, color: "#6B7280", marginBottom: 6 }}>Nothing confirmed for today in {area}</div>
                <div onClick={() => { setDayFilter("all"); setPage(1); }} style={{ fontSize: 13, fontWeight: 600, color: "#F97316", cursor: "pointer", marginBottom: 10 }}>Browse all activities →</div>
                {(() => { const upcoming = (listings||[]).filter(l => l.isEvent && l.eventDate && new Date(l.eventDate) > new Date()).sort((a,b) => new Date(a.eventDate)-new Date(b.eventDate)).slice(0,3); return upcoming.length > 0 ? (<div><div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 8 }}>📅 Upcoming events</div>{upcoming.map(item => <ListingCard key={item.id} item={item} onSelect={openDetail} userLoc={userLoc} isFav={favourites.includes(item.id)} onToggleFav={toggleFavourite} isNew={false} reviews={reviews} areaFilter={areaFilter} isSunny={isSunny} onTrackClick={trackClick} clickCount={clickCounts[item.id]||0} />)}</div>) : null; })()}
              </div>
            ) : todayList.map((item, idx) => {
              const signal = getTodaySignal(item, idx, clickCounts[item.id] || 0);
              return (
                <div key={"today-" + item.id}>
                  <ListingCard item={item} onSelect={openDetail} userLoc={userLoc} isFav={favourites.includes(item.id)} onToggleFav={toggleFavourite} isNew={isNewActivity(item)} reviews={reviews} areaFilter={areaFilter} isSunny={isSunny} onTrackClick={trackClick} clickCount={clickCounts[item.id] || 0} todaySignal={signal} />
                </div>
              );
            })}
            {todayListFull.length > TODAY_LIMIT && (
              <div onClick={() => document.getElementById("all-activities")?.scrollIntoView({ behavior: "smooth", block: "start" })} style={{ textAlign: "center", padding: "10px 0 4px", fontSize: 13, fontWeight: 600, color: "#F97316", cursor: "pointer" }}>
                Browse all activities →
              </div>
            )}
          </div>


          {/* Featured Providers — Hartbeeps (primary) + LGD (secondary) */}
          {(() => {
            const hartbeeps = listings.find(a => a.name && a.name.toLowerCase().includes("hartbeeps"));
            const lgd = listings.find(a => a.featuredProvider);
            const hDist = hartbeeps ? getDist(hartbeeps) : null;
            const hWalk = hDist && hDist < 50 ? Math.round(hDist * 1.60934 * 12) : null;
            const lDist = lgd ? getDist(lgd) : null;
            const lWalk = lDist && lDist < 50 ? Math.round(lDist * 1.60934 * 12) : null;
            return (<>
              {/* Hartbeeps — Premium Featured */}
              {hartbeeps && (
              <div style={{ marginTop: 32, padding: "0 20px" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 10 }}>Featured provider</div>
                <div onClick={() => openDetail(hartbeeps)} style={{ background: "white", borderRadius: 16, padding: 0, cursor: "pointer", border: "1px solid rgba(124, 77, 255, 0.25)", overflow: "hidden", boxShadow: "0 4px 14px rgba(0,0,0,0.04)" }}>
                  <div style={{ position: "relative" }}>
                    <div style={{ display: "flex", overflowX: "auto", scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}>
                      {[{src:"/hartbeeps-hero.png",focalY:22},{src:"/hartbeeps-bells.jpg",focalY:50},{src:"/hartbeeps-happy.png",focalY:45}].map((img, i) => (
                        <img key={i} src={img.src} alt="Hartbeeps class" style={{ width: "100%", height: 180, objectFit: "cover", objectPosition: `center ${img.focalY}%`, flexShrink: 0, scrollSnapAlign: "start" }} />
                      ))}
                    </div>
                    <span style={{ position: "absolute", top: 10, left: 10, fontSize: 10, fontWeight: 700, padding: "4px 12px", borderRadius: 8, background: "#6050F0", color: "white", letterSpacing: 0.3, boxShadow: "0 2px 8px rgba(107,78,255,0.3)" }}>Featured baby classes</span>
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 50, background: "linear-gradient(transparent, rgba(0,0,0,0.25))", pointerEvents: "none" }} />
                    <div style={{ position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 4 }}>
                      {[0,1,2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(255,255,255,0.85)" }} />)}
                    </div>
                  </div>
                  <div style={{ padding: "14px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 17, fontWeight: 800, color: "#222" }}>Hartbeeps West & SW London</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>Award-winning baby sensory and music classes loved by local parents.</div>
                    <div style={{ fontSize: 13, color: "#4B5563", marginBottom: 3 }}>Baby Sensory · 0–4 yrs · Various days</div>
                    <div style={{ fontSize: 13, color: "#4B5563", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
                      Haven Green Church, Ealing Broadway
                      {hWalk !== null && hWalk < 60 && <span style={{ color: "#F97316", fontWeight: 600 }}>· {hWalk < 2 ? "Nearby" : hWalk + " min walk"}</span>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#15803D", padding: "2px 8px", background: "#ECFDF5", borderRadius: 6 }}>Free trial available</span>
                      
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12, fontWeight: 700, padding: "5px 10px", borderRadius: 8, background: "#FDF6EE", color: "#92400E" }}>From £8/class</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#6050F0" }}>View details →</span>
                    </div>
                  </div>
                </div>
              </div>
              )}

              {/* LGD — Secondary Featured */}
              {lgd && (
              <div style={{ marginTop: 20, padding: "0 20px" }}>
                <div onClick={() => openDetail(lgd)} style={{ background: "white", borderRadius: 16, padding: 0, cursor: "pointer", border: "1px solid rgba(124, 77, 255, 0.25)", overflow: "hidden", boxShadow: "0 4px 14px rgba(0,0,0,0.04)" }}>
                  <div style={{ width: "100%", height: 140, overflow: "hidden", position: "relative" }}>
                    <img src="/lgd-dance.png" alt={lgd.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    <span style={{ position: "absolute", top: 10, left: 10, fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 6, background: "#6050F0", color: "white", letterSpacing: 0.3 }}>Featured local provider</span>
                  </div>
                  <div style={{ padding: "14px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: "#222" }}>{lgd.name}</span>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: "#F97316", color: "white", letterSpacing: 0.3 }}>NEW</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 4 }}>Fun, friendly dance classes in West Ealing</div>
                    <div style={{ fontSize: 13, color: "#4B5563", marginBottom: 3 }}>{lgd.type} · {lgd.ages} · {lgd.day}</div>
                    <div style={{ fontSize: 13, color: "#4B5563", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", marginBottom: 4 }}>
                      {lgd.venue.split(",")[0]}, {lgd.location}
                      {lWalk !== null && lWalk < 60 && <span style={{ color: "#F97316", fontWeight: 600 }}>· {lWalk < 2 ? "Nearby" : lWalk + " min walk"}</span>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                      {lgd.freeTrial && <span style={{ fontSize: 11, fontWeight: 600, color: "#15803D", padding: "2px 8px", background: "#ECFDF5", borderRadius: 6 }}>Free trial available</span>}
                      
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12, fontWeight: 700, padding: "5px 10px", borderRadius: 8, background: "#FDF6EE", color: "#92400E" }}>{lgd.price}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#6050F0" }}>View details →</span>
                    </div>
                  </div>
                </div>
              </div>
              )}
            </>);
          })()}

          {/* 2. From your saved */}
          {savedList.length > 0 && (
            <div style={{ marginTop: 36, padding: "0 20px" }}>
              <div style={{ height: 1, background: "linear-gradient(to right, #F3F4F6, transparent)", marginBottom: 20 }} />
              <div style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.7px", marginBottom: 6 }}>❤️ From your saved</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#111827", letterSpacing: "-0.3px", marginBottom: 3 }}>Ready when you are</div>
              <div style={{ fontSize: 12, color: "#B0B0B0", marginBottom: 14 }}>Activities you've saved for later</div>
              {savedList.map(item => (
                <ListingCard key={"fromsaved-" + item.id} item={item} onSelect={openDetail} userLoc={userLoc} isFav={true} onToggleFav={toggleFavourite} isNew={isNewActivity(item)} reviews={reviews} areaFilter={areaFilter} isSunny={isSunny} onTrackClick={trackClick} clickCount={clickCounts[item.id] || 0} />
              ))}
            </div>
          )}

          {/* 3. This weekend */}
          {popularList.length > 0 && (
            <div style={{ marginTop: 36, padding: "0 20px" }}>
              <div style={{ height: 1, background: "linear-gradient(to right, #F3F4F6, transparent)", marginBottom: 20 }} />
              <div style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.7px", marginBottom: 6 }}>📅 Coming up</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#111827", letterSpacing: "-0.3px", marginBottom: 3 }}>This weekend in {area}</div>
              <div style={{ fontSize: 12, color: "#B0B0B0", marginBottom: 14 }}>Best things to do with your kids this weekend</div>
              {popularList.map(item => (
                <ListingCard key={"pop-" + item.id} item={item} onSelect={openDetail} userLoc={userLoc} isFav={favourites.includes(item.id)} onToggleFav={toggleFavourite} isNew={isNewActivity(item)} reviews={reviews} areaFilter={areaFilter} isSunny={isSunny} onTrackClick={trackClick} clickCount={clickCounts[item.id] || 0} />
              ))}
            </div>
          )}

          {/* 4. Loved by Ealing parents */}
          {lovedList.length > 0 && (
            <div style={{ marginTop: 36, padding: "0 20px" }}>
              <div style={{ height: 1, background: "linear-gradient(to right, #F3F4F6, transparent)", marginBottom: 20 }} />
              <div style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.7px", marginBottom: 6 }}>⭐ Parent picks</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#111827", letterSpacing: "-0.3px", marginBottom: 3 }}>Loved by {area} parents</div>
              <div style={{ fontSize: 12, color: "#B0B0B0", marginBottom: 14 }}>Saved and recommended by families like yours</div>
              {lovedList.map(item => (
                <ListingCard key={"loved-" + item.id} item={item} onSelect={openDetail} userLoc={userLoc} isFav={favourites.includes(item.id)} onToggleFav={toggleFavourite} isNew={isNewActivity(item)} reviews={reviews} areaFilter={areaFilter} isSunny={isSunny} onTrackClick={trackClick} clickCount={clickCounts[item.id] || 0} />
              ))}
            </div>
          )}
        </>);
      })()}

      {/* === MAIN LISTING GRID === */}
      {(() => {
        const mainFiltered = (page === 1 && !search && !showFavourites && dayFilter === "today") ? filtered.filter(a => !shownIdsRef.current.has(a.id)) : filtered;
        const pageSize = 6;
        const pagedList = mainFiltered.slice((page - 1) * pageSize, page * pageSize);
        const displayList = (page === 1 && !search && !showFavourites && dayFilter === "today") ? pagedList.slice(0, 3) : pagedList;
        return (
      <div id="all-activities" style={{ padding: "0 20px 20px" }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 20px", color: "#4B5563" }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#6B7280", marginBottom: 10 }}>{weatherMode === "rainy" ? "No indoor results found" : weatherMode === "sunny" ? "No outdoor results found" : "No results found"}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1F2937", marginBottom: 4 }}>{areaFilter !== "All Areas" ? `Nothing found in ${areaFilter}` : dayFilter === "today" ? `Nothing found for ${todayName}` : "No activities match your filters"}</div>
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 16, lineHeight: 1.5 }}>{areaFilter !== "All Areas" ? "Try a different area or broaden your filters" : "Try fewer filters or search for something else"}</div>
            <div onClick={() => { setCityFilter("All"); setAreaFilter("All Areas"); setDayFilter("today"); setWeatherMode("all"); setNapFilter("all"); setFreeOnly(false); setAgeFilter("all"); setTypeFilter("All Types"); setSearch(""); setSortBy("mixed"); setPage(1); setShowFavourites(false); }} style={{ display: "inline-block", padding: "10px 24px", background: "linear-gradient(135deg, #F97316, #FB923C)", color: "white", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Reset all filters</div>
          </div>
        ) : (
          <>
          {page === 1 && <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0 12px" }}>
            <div style={{ flex: 1, height: 1, background: "#E5E7EB" }} />
            <span style={{ fontSize: 11, color: "#C0C0C0", fontWeight: 400 }}>Trusted by {areaFilter !== "All Areas" ? areaFilter : "Ealing"} parents</span>
            <div style={{ flex: 1, height: 1, background: "#E5E7EB" }} />
          </div>}
          {displayList.map((item, idx) => {
            const isNew = item.createdAt ? (Date.now() - new Date(item.createdAt).getTime()) < 14 * 24 * 60 * 60 * 1000 : false;
            return <React.Fragment key={item.id}>
              <ListingCard item={item} onSelect={openDetail} userLoc={userLoc} isFav={favourites.includes(item.id)} onToggleFav={toggleFavourite} isNew={isNew} reviews={reviews} areaFilter={areaFilter} isSunny={isSunny} onTrackClick={trackClick} clickCount={clickCounts[item.id] || 0} />
              {false && (
                <div onClick={openSuggest} style={{ margin: "6px 0 8px", padding: "12px 16px", background: "linear-gradient(135deg, #F9FAFB, #FDDDE6)", borderRadius: 14, display: "flex", alignItems: "center", gap: 10, cursor: "pointer", border: "1.5px dashed #F97316" }}>
                  <span style={{ fontSize: 22 }}>✨</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#1F2937" }}>Know a great activity we missed?</div>
                    <div style={{ fontSize: 11, color: "#6B7280" }}>Help other parents discover it.</div>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "white", padding: "6px 14px", background: "linear-gradient(135deg, #F97316, #FB923C)", borderRadius: 10 }}>Add</span>
                </div>
              )}
            </React.Fragment>;
          })}
          {page === 1 && !showSuggest && (
            <div onClick={openSuggest} style={{ margin: "6px 0 8px", padding: "12px 16px", background: "linear-gradient(135deg, #F9FAFB, #FDDDE6)", borderRadius: 14, display: "flex", alignItems: "center", gap: 10, cursor: "pointer", border: "1.5px dashed #F97316" }}>
              <span style={{ fontSize: 22 }}>✨</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#1F2937" }}>Know a great activity we missed?</div>
                <div style={{ fontSize: 11, color: "#6B7280" }}>Help other parents discover it.</div>
              </div>
              <span style={{ fontSize: 12, fontWeight: 800, color: "white", padding: "6px 14px", background: "linear-gradient(135deg, #F97316, #FB923C)", borderRadius: 10 }}>Add</span>
            </div>
          )}
          </>
        )}
      </div>
        );
      })()}

      {/* Suggested Activities — horizontal scroll, clickable to listing */}
      {(() => {
        // Show suggested activities from Supabase suggestions table, plus recent Ealing listings as "parent picks"
        const parentPicks = listings.filter(l => l.location === "Ealing" && l.verified).slice(-8).reverse();
        const suggestedChips = suggestedActivities.length > 0 ? suggestedActivities : [];
        const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
        const allChips = [...suggestedChips.map(s => ({ id: "s-" + s.id, name: s.name, type: s.type, match: listings.find(l => norm(l.name) === norm(s.name)) || listings.find(l => norm(l.name).includes(norm(s.name)) || norm(s.name).includes(norm(l.name))) })), ...parentPicks.filter(p => !suggestedChips.some(s => norm(s.name) === norm(p.name))).map(p => ({ id: "p-" + p.id, name: p.name, type: p.type, match: p }))];
        if (allChips.length === 0) return null;
        return (
        <div style={{ padding: "0 0 6px" }}>
          <div style={{ fontSize: 10, fontWeight: 600, marginBottom: 4, color: "#9CA3AF", paddingLeft: 20 }}>✨ Suggested & added by parents</div>
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingLeft: 20, paddingRight: 20 }}>
            {allChips.slice(0, 10).map(c => (
              <div key={c.id} onClick={() => { if (c.match) openDetail(c.match); }} style={{ flexShrink: 0, padding: "5px 10px", background: "white", borderRadius: 8, border: "1px dashed #E5E7EB", cursor: c.match ? "pointer" : "default", maxWidth: 140 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: c.match ? "#F97316" : "#1F2937", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
                <div style={{ fontSize: 8, color: "#9CA3AF" }}>{c.type}</div>
              </div>
            ))}
          </div>
        </div>
        );
      })()}

      {/* Pagination controls */}
      {(() => {
        const totalPages = Math.ceil(filtered.length / 6);
        if (totalPages <= 1) return null;
        return (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "0 20px 16px" }}>
            <button onClick={() => { setPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: "smooth" }); }} disabled={page === 1} style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid #E5E7EB", background: page === 1 ? "#F3F4F6" : "white", color: page === 1 ? "#9CA3AF" : "#1F2937", fontSize: 12, fontWeight: 600, cursor: page === 1 ? "default" : "pointer", fontFamily: "inherit" }}>← Prev</button>
            <div style={{ display: "flex", gap: 4 }}>
              {Array.from({ length: totalPages }, (_, i) => i + 1).filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1).map((p, idx, arr) => (
                <React.Fragment key={p}>
                  {idx > 0 && arr[idx - 1] < p - 1 && <span style={{ color: "#9CA3AF", fontSize: 12, padding: "0 2px" }}>...</span>}
                  <button onClick={() => { setPage(p); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{ width: 32, height: 32, borderRadius: 8, border: page === p ? "none" : "1px solid #E5E7EB", background: page === p ? "linear-gradient(135deg, #F97316, #FB923C)" : "white", color: page === p ? "white" : "#6B7394", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{p}</button>
                </React.Fragment>
              ))}
            </div>
            <button onClick={() => { setPage(p => Math.min(totalPages, p + 1)); window.scrollTo({ top: 0, behavior: "smooth" }); }} disabled={page === totalPages} style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid #E5E7EB", background: page === totalPages ? "#F3F4F6" : "white", color: page === totalPages ? "#9CA3AF" : "#1F2937", fontSize: 12, fontWeight: 600, cursor: page === totalPages ? "default" : "pointer", fontFamily: "inherit" }}>Next →</button>
          </div>
        );
      })()}
      </>}

      <div style={{ textAlign: "center", padding: "20px 20px 8px", fontSize: 11, color: "#C4C4C4" }}>
        community-powered kids activity discovery
      </div>

      <div style={{ textAlign: "center", padding: "32px 20px 28px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 6 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, overflow: "hidden" }}><BrandBear size={34} /></div>
          <span style={{ fontSize: 16, fontWeight: 800, color: "#1F2937" }}>LITTLE<span style={{ color: "#F97316" }}>locals</span></span>
        </div>
        <div style={{ fontSize: 10, color: "#9CA3AF", marginBottom: 8, lineHeight: 1.4 }}>Built by parents, for parents.</div>
        <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
          <span onClick={() => setLegalPage("privacy")} style={{ fontSize: 10, color: "#6B7280", cursor: "pointer", textDecoration: "underline" }}>Privacy Policy</span>
          <span onClick={() => setLegalPage("cookies")} style={{ fontSize: 10, color: "#6B7280", cursor: "pointer", textDecoration: "underline" }}>Cookie Policy</span>
          <span onClick={() => setLegalPage("terms")} style={{ fontSize: 10, color: "#6B7280", cursor: "pointer", textDecoration: "underline" }}>Terms of Service</span>
          <a href="mailto:littlelocalsuk@gmail.com" style={{ fontSize: 10, color: "#6B7280", textDecoration: "underline" }}>Contact</a>
        </div>
        <div style={{ fontSize: 9, color: "#9CA3AF" }}>© 2026 LITTLElocals. All rights reserved.</div>
        {showInstallBanner && <div style={{ height: 44 }} />}
      </div>

      </>}

      {/* Floating "Top" button */}
      {showScrollTop && (
        <div onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} style={{ position: "fixed", bottom: showInstallBanner ? 60 : 20, right: 16, padding: "8px 12px", background: "white", borderRadius: 12, border: "1px solid #E5E7EB", boxShadow: "0 4px 12px rgba(0,0,0,0.08)", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#1F2937", zIndex: 998, transition: "bottom 0.2s" }}>↑ Top</div>
      )}

      {/* Add to Home Screen Banner */}
      {showInstallBanner && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "white", zIndex: 999, borderTop: "1px solid #E5E7EB" }}>
          {/iPhone|iPad|iPod/.test(navigator.userAgent) ? (
            <div style={{ padding: "12px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <img src="/bear-logo.png" alt="LITTLElocals" style={{ width: 28, height: 28, borderRadius: 6 }} />
                  <span style={{ fontSize: 12, fontWeight: 800, color: "#1F2937" }}>Save as an app!</span>
                </div>
                <div onClick={() => { setShowInstallBanner(false); try { localStorage.setItem("ll_install_dismissed", "1"); } catch(e) {} }} style={{ fontSize: 11, color: "#6B7280", cursor: "pointer", padding: "4px 8px" }}>✕</div>
              </div>
              <div style={{ fontSize: 11, color: "#4B5563", lineHeight: 1.5 }}>
                {/CriOS|FxiOS/.test(navigator.userAgent) ? (
                  <span>Open this page in <span style={{ fontWeight: 700 }}>Safari</span>, then tap <span style={{ display: "inline-block", padding: "1px 6px", background: "#E5E7EB", borderRadius: 4, fontWeight: 700 }}>⬆ Share</span> → <span style={{ display: "inline-block", padding: "1px 6px", background: "#E5E7EB", borderRadius: 4, fontWeight: 700 }}>Add to Home Screen</span></span>
                ) : (
                  <span>Tap <span style={{ display: "inline-block", padding: "1px 6px", background: "#E5E7EB", borderRadius: 4, fontWeight: 700 }}>⬆ Share</span> in the Safari toolbar below, then scroll down and tap <span style={{ display: "inline-block", padding: "1px 6px", background: "#E5E7EB", borderRadius: 4, fontWeight: 700 }}>Add to Home Screen</span></span>
                )}
              </div>
            </div>
          ) : (
            <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 10 }}>
              <img src="/bear-logo.png" alt="LITTLElocals" style={{ width: 28, height: 28, borderRadius: 6 }} />
              <div onClick={async () => { if (installPrompt) { installPrompt.prompt(); const result = await installPrompt.userChoice; if (result.outcome === "accepted") { setShowInstallBanner(false); try { localStorage.setItem("ll_install_dismissed", "1"); } catch(e) {} } setInstallPrompt(null); } }} style={{ flex: 1, fontSize: 11, color: "#1F2937", cursor: "pointer" }}>
                <span style={{ fontWeight: 700 }}>{installPrompt ? "Tap to install app" : "Add to home screen"}</span> for quick access
              </div>
              <div onClick={() => { setShowInstallBanner(false); try { localStorage.setItem("ll_install_dismissed", "1"); } catch(e) {} }} style={{ fontSize: 11, color: "#6B7280", cursor: "pointer", padding: "4px 8px" }}>✕</div>
            </div>
          )}
        </div>
      )}
      {/* Cookie Consent Banner */}
      {cookieConsent === null && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "white", borderTop: "1px solid #E5E5E5", padding: "12px 20px", zIndex: 9999, maxWidth: 480, margin: "0 auto" }}>
          <div style={{ fontSize: 12, color: "#4B5563", lineHeight: 1.5, marginBottom: 10 }}>
            We use simple analytics to understand how LITTLElocals is used and improve it for parents. No ads. No tracking across other sites.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div onClick={acceptCookies} style={{ flex: 1, padding: "8px 0", textAlign: "center", background: "#6050F0", color: "white", borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Accept</div>
            <div onClick={declineCookies} style={{ flex: 1, padding: "8px 0", textAlign: "center", background: "#F3F4F6", color: "#4B5563", borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Decline</div>
          </div>
        </div>
      )}

      {/* Legal Pages Overlay */}
      {legalPage && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "#F9FAFB", zIndex: 10000, overflowY: "auto", maxWidth: 480, margin: "0 auto" }}>
          <div style={{ padding: "16px 20px", position: "sticky", top: 0, background: "#F9FAFB", borderBottom: "1px solid #E5E7EB", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#1F2937" }}>
              {legalPage === "privacy" && "Privacy Policy"}
              {legalPage === "cookies" && "Cookie Policy"}
              {legalPage === "terms" && "Terms of Service"}
            </div>
            <div onClick={() => setLegalPage(null)} style={{ padding: "6px 12px", background: "white", borderRadius: 10, border: "1px solid #E5E7EB", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#1F2937" }}>← Back</div>
          </div>
          <div style={{ padding: "20px", fontSize: 13, color: "#4B5563", lineHeight: 1.7 }}>
            {legalPage === "privacy" && (<>
              <p style={{ fontWeight: 700, color: "#1F2937", fontSize: 18, marginBottom: 16 }}>Privacy Policy for LITTLElocals</p>
              <p style={{ color: "#6B7280", marginBottom: 16 }}>Last updated: 28 February 2026</p>
              <p style={{ marginBottom: 12 }}>LITTLElocals is a community-powered directory of kids' activities. We take your privacy seriously and are committed to protecting your personal data.</p>
              <p style={{ fontWeight: 700, color: "#1F2937", marginBottom: 6, marginTop: 16 }}>What we collect</p>
              <p style={{ marginBottom: 12 }}>When you suggest an activity, you may optionally provide your name and email address. This information is stored securely and used only to follow up on your suggestion if needed.</p>
              <p style={{ fontWeight: 700, color: "#1F2937", marginBottom: 6, marginTop: 16 }}>Local storage</p>
              <p style={{ marginBottom: 12 }}>We use your browser's local storage to save your preferences such as favourites, calendar plans, and cookie consent. This data stays on your device and is not sent to our servers.</p>
              <p style={{ fontWeight: 700, color: "#1F2937", marginBottom: 6, marginTop: 16 }}>Cookies & Analytics</p>
              <p style={{ marginBottom: 12 }}>We use privacy-friendly analytics to understand how LITTLElocals is used and improve the service. This data is anonymous and not used for advertising. Analytics cookies are only loaded if you accept them via our cookie consent banner.</p>
              <p style={{ fontWeight: 700, color: "#1F2937", marginBottom: 6, marginTop: 16 }}>Your rights</p>
              <p style={{ marginBottom: 12 }}>Under UK GDPR, you have the right to access, correct, or delete your personal data. You can also withdraw consent for analytics cookies at any time by clearing your browser's local storage.</p>
              <p style={{ fontWeight: 700, color: "#1F2937", marginBottom: 6, marginTop: 16 }}>Data sharing</p>
              <p style={{ marginBottom: 12 }}>We do not sell, trade, or share your personal data with third parties. We do not use your data for advertising purposes.</p>
              <p style={{ fontWeight: 700, color: "#1F2937", marginBottom: 6, marginTop: 16 }}>Contact</p>
              <p>If you have any questions about this privacy policy, please contact us at <a href="mailto:littlelocalsuk@gmail.com" style={{ color: "#6050F0" }}>littlelocalsuk@gmail.com</a></p>
            </>)}

            {legalPage === "cookies" && (<>
              <p style={{ fontWeight: 700, color: "#1F2937", fontSize: 18, marginBottom: 16 }}>Cookie Policy for LITTLElocals</p>
              <p style={{ color: "#6B7280", marginBottom: 16 }}>Last updated: 28 February 2026</p>
              <p style={{ marginBottom: 12 }}>LITTLElocals uses analytics cookies to understand how the site is used and improve the experience for parents.</p>
              <p style={{ marginBottom: 12 }}>These cookies collect anonymous information such as pages visited and interactions.</p>
              <p style={{ marginBottom: 12 }}>We do not use cookies for advertising.</p>
              <p style={{ marginBottom: 12 }}>We do not sell your data.</p>
              <p style={{ marginBottom: 12 }}>You can accept or decline analytics cookies when you first visit the site. Your choice is saved in your browser and you can change it at any time by clearing your browser data.</p>
              <p style={{ fontWeight: 700, color: "#1F2937", marginBottom: 6, marginTop: 16 }}>Types of cookies we use</p>
              <p style={{ marginBottom: 12 }}><span style={{ fontWeight: 600 }}>Analytics cookies (optional):</span> Google Analytics — helps us understand how parents use LITTLElocals so we can improve it. Only loaded if you accept.</p>
              <p style={{ marginBottom: 12 }}><span style={{ fontWeight: 600 }}>Essential storage:</span> We use localStorage (not cookies) to save your preferences like favourites and calendar plans. These are essential for the app to work and stay on your device.</p>
              <p style={{ fontWeight: 700, color: "#1F2937", marginBottom: 6, marginTop: 16 }}>Contact</p>
              <p>If you have questions, contact us at <a href="mailto:littlelocalsuk@gmail.com" style={{ color: "#6050F0" }}>littlelocalsuk@gmail.com</a></p>
            </>)}

            {legalPage === "terms" && (<>
              <p style={{ fontWeight: 700, color: "#1F2937", fontSize: 18, marginBottom: 16 }}>Terms of Service for LITTLElocals</p>
              <p style={{ color: "#6B7280", marginBottom: 16 }}>Last updated: 28 February 2026</p>
              <p style={{ marginBottom: 12 }}>Welcome to LITTLElocals. By using our website you agree to the following terms.</p>
              <p style={{ fontWeight: 700, color: "#1F2937", marginBottom: 6, marginTop: 16 }}>About the service</p>
              <p style={{ marginBottom: 12 }}>LITTLElocals is a free community directory of kids' activities in the Ealing area and surrounding boroughs. We aim to provide accurate and up-to-date information but cannot guarantee the accuracy of all listings.</p>
              <p style={{ fontWeight: 700, color: "#1F2937", marginBottom: 6, marginTop: 16 }}>User contributions</p>
              <p style={{ marginBottom: 12 }}>When you suggest an activity or leave a review, you grant LITTLElocals permission to display that content on the site. You agree that your contributions are accurate and not misleading.</p>
              <p style={{ fontWeight: 700, color: "#1F2937", marginBottom: 6, marginTop: 16 }}>Disclaimer</p>
              <p style={{ marginBottom: 12 }}>LITTLElocals is provided "as is". We are not responsible for the quality, safety, or availability of activities listed on the platform. Always check directly with activity providers for the most current information.</p>
              <p style={{ fontWeight: 700, color: "#1F2937", marginBottom: 6, marginTop: 16 }}>Intellectual property</p>
              <p style={{ marginBottom: 12 }}>All content, design, and branding on LITTLElocals is owned by LITTLElocals and may not be reproduced without permission.</p>
              <p style={{ fontWeight: 700, color: "#1F2937", marginBottom: 6, marginTop: 16 }}>Contact</p>
              <p>If you have any questions about these terms, please contact us at <a href="mailto:littlelocalsuk@gmail.com" style={{ color: "#6050F0" }}>littlelocalsuk@gmail.com</a></p>
            </>)}
          </div>
        </div>
      )}
    </div>
  );
}


export default WestLondonListings;
