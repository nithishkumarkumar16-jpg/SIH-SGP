import os
from PIL import Image, ImageDraw, ImageFont, JpegImagePlugin, PngImagePlugin, PdfImagePlugin

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "test_fixtures", "synthetic")
os.makedirs(OUT_DIR, exist_ok=True)

def get_font(size=20):
    try:
        # Standard Windows fonts
        return ImageFont.truetype("arial.ttf", size)
    except:
        return ImageFont.load_default()

def get_tamil_font(size=20):
    for f in ["Nirmala.ttf", "Latha.ttf", "arial.ttf"]:
        try:
            return ImageFont.truetype(f, size)
        except:
            continue
    return get_font(size)

# 1. English Marksheet (10th Board Certificate)
def create_english_marksheet():
    img = Image.new("RGB", (1200, 1600), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    font_lg = get_font(32)
    font_md = get_font(22)
    font_sm = get_font(18)

    # Border
    draw.rectangle([30, 30, 1170, 1570], outline=(15, 23, 42), width=4)
    draw.rectangle([40, 40, 1160, 1560], outline=(71, 85, 105), width=1)

    # Header
    draw.text((360, 90), "CENTRAL BOARD OF SECONDARY EDUCATION", fill=(15, 23, 42), font=font_lg)
    draw.text((450, 140), "SECONDARY SCHOOL EXAMINATION - 2022", fill=(51, 65, 85), font=font_md)
    draw.text((490, 180), "MARKS STATEMENT", fill=(30, 41, 59), font=font_lg)

    # Details
    draw.text((100, 260), "CANDIDATE NAME:  VIKRAM RAMAN", fill=(0, 0, 0), font=font_md)
    draw.text((100, 310), "FATHER'S NAME:   RAMAN K", fill=(0, 0, 0), font=font_md)
    draw.text((100, 360), "DATE OF BIRTH:   14/07/2006", fill=(0, 0, 0), font=font_md)
    draw.text((100, 410), "ROLL NUMBER:     1098452", fill=(0, 0, 0), font=font_md)
    draw.text((100, 460), "SCHOOL NAME:     GOVT MODEL HIGHER SECONDARY SCHOOL", fill=(0, 0, 0), font=font_md)
    draw.text((100, 510), "PASSING YEAR:    2022", fill=(0, 0, 0), font=font_md)

    # Table
    y = 600
    draw.rectangle([100, y, 1100, y + 40], fill=(226, 232, 240), outline=(0, 0, 0), width=1)
    draw.text((120, y + 10), "SUB CODE", fill=(0, 0, 0), font=font_sm)
    draw.text((300, y + 10), "SUBJECT NAME", fill=(0, 0, 0), font=font_sm)
    draw.text((700, y + 10), "MARKS SCORED", fill=(0, 0, 0), font=font_sm)
    draw.text((950, y + 10), "MAX MARKS", fill=(0, 0, 0), font=font_sm)

    subs = [
        ("101", "ENGLISH COMMUNICATIVE", "92", "100"),
        ("085", "TAMIL LANGUAGE", "95", "100"),
        ("041", "MATHEMATICS STANDARD", "88", "100"),
        ("086", "SCIENCE THEORY & PRACTICAL", "91", "100"),
        ("087", "SOCIAL SCIENCE", "89", "100"),
    ]

    for code, name, scored, max_m in subs:
        y += 45
        draw.rectangle([100, y, 1100, y + 45], outline=(203, 213, 225), width=1)
        draw.text((120, y + 12), code, fill=(0, 0, 0), font=font_sm)
        draw.text((300, y + 12), name, fill=(0, 0, 0), font=font_sm)
        draw.text((740, y + 12), scored, fill=(0, 0, 0), font=font_sm)
        draw.text((980, y + 12), max_m, fill=(0, 0, 0), font=font_sm)

    # Totals
    y += 60
    draw.rectangle([100, y, 1100, y + 50], outline=(15, 23, 42), width=2)
    draw.text((120, y + 14), "TOTAL MARKS SCORED: 455 / 500", fill=(0, 0, 0), font=font_md)
    draw.text((750, y + 14), "PERCENTAGE: 91.0% | RESULT: PASS", fill=(0, 0, 0), font=font_md)

    path = os.path.join(OUT_DIR, "synthetic_marksheet_en.png")
    img.save(path)
    print(f"Created: {path}")

# 1b. English High School Marksheet (Original Shaded Regression Fixture)
def create_english_marksheet_shaded():
    img = Image.new("RGB", (1200, 1600), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    font_lg = get_font(32)
    font_md = get_font(22)
    font_sm = get_font(18)

    # Border
    draw.rectangle([30, 30, 1170, 1570], outline=(15, 23, 42), width=4)
    draw.rectangle([40, 40, 1160, 1560], outline=(71, 85, 105), width=1)

    # Header
    draw.text((360, 90), "CENTRAL BOARD OF SECONDARY EDUCATION", fill=(15, 23, 42), font=font_lg)
    draw.text((450, 140), "SECONDARY SCHOOL EXAMINATION - 2022", fill=(51, 65, 85), font=font_md)
    draw.text((490, 180), "MARKS STATEMENT", fill=(30, 41, 59), font=font_lg)

    # Details
    draw.text((100, 260), "CANDIDATE NAME:  VIKRAM RAMAN", fill=(0, 0, 0), font=font_md)
    draw.text((100, 310), "FATHER'S NAME:   RAMAN K", fill=(0, 0, 0), font=font_md)
    draw.text((100, 360), "DATE OF BIRTH:   14/07/2006", fill=(0, 0, 0), font=font_md)
    draw.text((100, 410), "ROLL NUMBER:     1098452", fill=(0, 0, 0), font=font_md)
    draw.text((100, 460), "SCHOOL NAME:     GOVT MODEL HIGHER SECONDARY SCHOOL", fill=(0, 0, 0), font=font_md)
    draw.text((100, 510), "PASSING YEAR:    2022", fill=(0, 0, 0), font=font_md)

    # Table
    y = 600
    draw.rectangle([100, y, 1100, y + 40], fill=(226, 232, 240), outline=(0, 0, 0), width=1)
    draw.text((120, y + 10), "SUB CODE", fill=(0, 0, 0), font=font_sm)
    draw.text((300, y + 10), "SUBJECT NAME", fill=(0, 0, 0), font=font_sm)
    draw.text((700, y + 10), "MARKS SCORED", fill=(0, 0, 0), font=font_sm)
    draw.text((950, y + 10), "MAX MARKS", fill=(0, 0, 0), font=font_sm)

    subs = [
        ("101", "ENGLISH COMMUNICATIVE", "92", "100"),
        ("085", "TAMIL LANGUAGE", "95", "100"),
        ("041", "MATHEMATICS STANDARD", "88", "100"),
        ("086", "SCIENCE THEORY & PRACTICAL", "91", "100"),
        ("087", "SOCIAL SCIENCE", "89", "100"),
    ]

    for code, name, scored, max_m in subs:
        y += 45
        draw.rectangle([100, y, 1100, y + 45], outline=(203, 213, 225), width=1)
        draw.text((120, y + 12), code, fill=(0, 0, 0), font=font_sm)
        draw.text((300, y + 12), name, fill=(0, 0, 0), font=font_sm)
        draw.text((740, y + 12), scored, fill=(0, 0, 0), font=font_sm)
        draw.text((980, y + 12), max_m, fill=(0, 0, 0), font=font_sm)

    # Original Shaded Totals Row
    y += 60
    draw.rectangle([100, y, 1100, y + 50], fill=(241, 245, 249), outline=(15, 23, 42), width=2)
    draw.text((120, y + 14), "TOTAL MARKS SCORED: 455 / 500", fill=(0, 0, 0), font=font_md)
    draw.text((750, y + 14), "PERCENTAGE: 91.0% | RESULT: PASS", fill=(0, 0, 0), font=font_md)

    path = os.path.join(OUT_DIR, "synthetic_marksheet_shaded_en.png")
    img.save(path)
    print(f"Created: {path}")

# 2. Tamil Community Certificate
def create_tamil_community_cert():
    img = Image.new("RGB", (1200, 1600), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    font_lg = get_tamil_font(30)
    font_md = get_tamil_font(22)
    font_sm = get_tamil_font(18)

    draw.rectangle([30, 30, 1170, 1570], outline=(180, 83, 9), width=4)
    draw.text((380, 90), "தமிழ்நாடு அரசு / GOVERNMENT OF TAMIL NADU", fill=(180, 83, 9), font=font_lg)
    draw.text((430, 140), "வருவாய்த் துறை / REVENUE DEPARTMENT", fill=(30, 41, 59), font=font_md)
    draw.text((410, 190), "சாதிச் சான்றிதழ் / COMMUNITY CERTIFICATE", fill=(180, 83, 9), font=font_lg)

    draw.text((100, 300), "சான்றிதழ் எண் / CERTIFICATE NO: TN-COMM-2023-99881", fill=(0, 0, 0), font=font_md)
    draw.text((100, 360), "விண்ணப்ப எண் / APPLICATION NO: TN-APP-2023-55442", fill=(0, 0, 0), font=font_md)
    draw.text((100, 420), "மாணவர் பெயர் / STUDENT NAME: VIKRAM RAMAN", fill=(0, 0, 0), font=font_md)
    draw.text((100, 480), "தந்தை பெயர் / FATHER NAME: RAMAN K", fill=(0, 0, 0), font=font_md)
    draw.text((100, 540), "வகுப்பு / COMMUNITY: BACKWARD CLASS (BC)", fill=(0, 0, 0), font=font_md)
    draw.text((100, 600), "சாதி / CASTE: VADUGAR", fill=(0, 0, 0), font=font_md)
    draw.text((100, 660), "மாவட்டம் / DISTRICT: COIMBATORE", fill=(0, 0, 0), font=font_md)
    draw.text((100, 720), "வட்டம் / TALUK: COIMBATORE NORTH", fill=(0, 0, 0), font=font_md)
    draw.text((100, 780), "வழங்கிய தேதி / DATE OF ISSUE: 15/06/2023", fill=(0, 0, 0), font=font_md)
    draw.text((100, 840), "அதிகாரி / ISSUING AUTHORITY: TAHSILDAR / வட்டாட்சியர்", fill=(0, 0, 0), font=font_md)

    path = os.path.join(OUT_DIR, "synthetic_community_ta.png")
    img.save(path)
    print(f"Created: {path}")

# 3. Mixed English/Tamil Income Certificate
def create_mixed_income_cert():
    img = Image.new("RGB", (1200, 1600), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    font_lg = get_tamil_font(30)
    font_md = get_tamil_font(22)

    draw.rectangle([30, 30, 1170, 1570], outline=(37, 99, 235), width=4)
    draw.text((360, 90), "GOVERNMENT OF TAMIL NADU / தமிழ்நாடு அரசு", fill=(37, 99, 235), font=font_lg)
    draw.text((420, 140), "REVENUE DEPARTMENT / வருவாய்த் துறை", fill=(30, 41, 59), font=font_md)
    draw.text((450, 190), "INCOME CERTIFICATE / வருமானச் சான்றிதழ்", fill=(37, 99, 235), font=font_lg)

    draw.text((100, 300), "CERTIFICATE NO: TN-INC-2025-44221", fill=(0, 0, 0), font=font_md)
    draw.text((100, 360), "NAME OF APPLICANT: VIKRAM RAMAN", fill=(0, 0, 0), font=font_md)
    draw.text((100, 420), "FATHER / GUARDIAN NAME: RAMAN K", fill=(0, 0, 0), font=font_md)
    draw.text((100, 480), "ANNUAL INCOME: RS. 84,000", fill=(0, 0, 0), font=font_md)
    draw.text((100, 540), "INCOME IN WORDS: RUPEES EIGHTY FOUR THOUSAND ONLY", fill=(0, 0, 0), font=font_md)
    draw.text((100, 600), "DATE OF ISSUE: 15/05/2025", fill=(0, 0, 0), font=font_md)
    draw.text((100, 660), "VALID FINANCIAL YEAR: 2025-2026", fill=(0, 0, 0), font=font_md)
    draw.text((100, 720), "ISSUING AUTHORITY: TAHSILDAR / வட்டாட்சியர்", fill=(0, 0, 0), font=font_md)
    draw.text((100, 780), "DISTRICT: COIMBATORE / கோயம்புத்தூர்", fill=(0, 0, 0), font=font_md)

    path = os.path.join(OUT_DIR, "synthetic_income_bilingual.png")
    img.save(path)
    print(f"Created: {path}")

# 4. Multi-Page Scanned PDF (Page 1 Marksheet, Page 2 Higher Secondary Certificate)
def create_multipage_pdf():
    # Page 1: 12th Marksheet
    p1 = Image.new("RGB", (1200, 1600), color=(255, 255, 255))
    draw1 = ImageDraw.Draw(p1)
    font_lg = get_font(30)
    font_md = get_font(22)
    draw1.rectangle([30, 30, 1170, 1570], outline=(15, 23, 42), width=3)
    draw1.text((320, 100), "BOARD OF HIGHER SECONDARY EDUCATION, TAMIL NADU", fill=(15, 23, 42), font=font_lg)
    draw1.text((440, 160), "HIGHER SECONDARY COURSE CERTIFICATE (12TH)", fill=(30, 41, 59), font=font_md)
    draw1.text((100, 280), "STUDENT NAME: VIKRAM RAMAN", fill=(0, 0, 0), font=font_md)
    draw1.text((100, 340), "ROLL NUMBER: 1289410", fill=(0, 0, 0), font=font_md)
    draw1.text((100, 400), "PASSING YEAR: 2024", fill=(0, 0, 0), font=font_md)
    draw1.text((100, 460), "STREAM / GROUP: SCIENCE (PHYSICS, CHEMISTRY, MATHS, BIO)", fill=(0, 0, 0), font=font_md)
    draw1.text((100, 520), "MARKS SCORED: 540 / 600", fill=(0, 0, 0), font=font_md)
    draw1.text((100, 580), "PERCENTAGE: 90.0% | RESULT: PASS", fill=(0, 0, 0), font=font_md)
    draw1.text((500, 1500), "PAGE 1 OF 2", fill=(100, 116, 139), font=font_md)

    # Page 2: Subject Marks Breakdown & Verification Stamp
    p2 = Image.new("RGB", (1200, 1600), color=(255, 255, 255))
    draw2 = ImageDraw.Draw(p2)
    draw2.rectangle([30, 30, 1170, 1570], outline=(15, 23, 42), width=3)
    draw2.text((380, 100), "HIGHER SECONDARY COURSE — PAGE 2", fill=(15, 23, 42), font=font_lg)
    draw2.text((100, 240), "CANDIDATE: VIKRAM RAMAN (ROLL: 1289410)", fill=(0, 0, 0), font=font_md)
    draw2.text((100, 320), "PART I: TAMIL — 94 / 100", fill=(0, 0, 0), font=font_md)
    draw2.text((100, 380), "PART II: ENGLISH — 90 / 100", fill=(0, 0, 0), font=font_md)
    draw2.text((100, 440), "PART III: PHYSICS — 88 / 100", fill=(0, 0, 0), font=font_md)
    draw2.text((100, 500), "PART III: CHEMISTRY — 92 / 100", fill=(0, 0, 0), font=font_md)
    draw2.text((100, 560), "PART III: BIOLOGY — 86 / 100", fill=(0, 0, 0), font=font_md)
    draw2.text((100, 620), "PART III: MATHEMATICS — 90 / 100", fill=(0, 0, 0), font=font_md)
    draw2.text((100, 720), "VERIFIED BY HEADMASTER / HEADMISTRESS", fill=(0, 0, 0), font=font_md)
    draw2.text((500, 1500), "PAGE 2 OF 2", fill=(100, 116, 139), font=font_md)

    path = os.path.join(OUT_DIR, "synthetic_multipage_scan.pdf")
    p1.save(path, save_all=True, append_images=[p2])
    print(f"Created: {path}")

# 5. Rotated Income Certificate (90 degrees clockwise)
def create_rotated_income():
    src_path = os.path.join(OUT_DIR, "synthetic_income_bilingual.png")
    if os.path.exists(src_path):
        img = Image.open(src_path)
        rotated = img.rotate(270, expand=True) # 270 deg counter-clockwise = 90 deg clockwise
        path = os.path.join(OUT_DIR, "synthetic_rotated_income.png")
        rotated.save(path)
        print(f"Created: {path}")

# 6. Renewed Income Certificate (Same student, updated financial year & income)
def create_renewed_income():
    img = Image.new("RGB", (1200, 1600), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    font_lg = get_tamil_font(30)
    font_md = get_tamil_font(22)

    draw.rectangle([30, 30, 1170, 1570], outline=(5, 150, 105), width=4)
    draw.text((360, 90), "GOVERNMENT OF TAMIL NADU / தமிழ்நாடு அரசு", fill=(5, 150, 105), font=font_lg)
    draw.text((420, 140), "REVENUE DEPARTMENT / வருவாய்த் துறை", fill=(30, 41, 59), font=font_md)
    draw.text((430, 190), "RENEWED INCOME CERTIFICATE (2025-26)", fill=(5, 150, 105), font=font_lg)

    draw.text((100, 300), "CERTIFICATE NO: TN-INC-2025-99882 (RENEWED)", fill=(0, 0, 0), font=font_md)
    draw.text((100, 360), "NAME OF APPLICANT: VIKRAM RAMAN", fill=(0, 0, 0), font=font_md)
    draw.text((100, 420), "FATHER / GUARDIAN NAME: RAMAN K", fill=(0, 0, 0), font=font_md)
    draw.text((100, 480), "ANNUAL INCOME: RS. 92,000", fill=(0, 0, 0), font=font_md)
    draw.text((100, 540), "INCOME IN WORDS: RUPEES NINETY TWO THOUSAND ONLY", fill=(0, 0, 0), font=font_md)
    draw.text((100, 600), "DATE OF ISSUE: 12/06/2025", fill=(0, 0, 0), font=font_md)
    draw.text((100, 660), "VALID FINANCIAL YEAR: 2025-2026", fill=(0, 0, 0), font=font_md)
    draw.text((100, 720), "ISSUING AUTHORITY: TAHSILDAR / வட்டாட்சியர்", fill=(0, 0, 0), font=font_md)
    draw.text((100, 780), "DISTRICT: COIMBATORE / கோயம்புத்தூர்", fill=(0, 0, 0), font=font_md)

    path = os.path.join(OUT_DIR, "synthetic_renewed_income.png")
    img.save(path)
    print(f"Created: {path}")

if __name__ == "__main__":
    create_english_marksheet()
    create_english_marksheet_shaded()
    create_tamil_community_cert()
    create_mixed_income_cert()
    create_multipage_pdf()
    create_rotated_income()
    create_renewed_income()
    print("All synthetic test documents generated successfully!")
