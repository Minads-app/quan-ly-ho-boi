export function normalizeScannerInput(input: string): string {
    if (!input) return input;

    // Normalizing Vietnamese Telex typing mistakes for English/Numeric barcodes
    // e.g. typing "dd" in Telex becomes "đ"
    // We only map back cases that happen when typing ASCII letters using Telex.
    // Assuming barcodes/card codes are ASCII alphanumeric.

    let normalized = input;

    // Mapping of Vietnamese characters to their Telex keystroke equivalents
    // This handles the most common ones when scanning barcodes that contain letters
    const telexMap: Record<string, string> = {
        'ă': 'aw', 'Ă': 'AW',
        'â': 'aa', 'Â': 'AA',
        'đ': 'dd', 'Đ': 'DD',
        'ê': 'ee', 'Ê': 'EE',
        'ô': 'oo', 'Ô': 'OO',
        'ơ': 'ow', 'Ơ': 'OW',
        'ư': 'uw', 'Ư': 'UW',
        
        // Vowels with tone marks (more complex, but maybe barcode had numbers at the end like a1 -> á)
        // Usually barcodes are just letters and numbers. If a scanner types 'A1' and it becomes 'Á' (VNI)
        // or 'As' becomes 'Á' (Telex). We should handle Telex tones if they appear:
        'á': 'as', 'Á': 'AS',
        'à': 'af', 'À': 'AF',
        'ả': 'ar', 'Ả': 'AR',
        'ã': 'ax', 'Ã': 'AX',
        'ạ': 'aj', 'Ạ': 'AJ',

        'é': 'es', 'É': 'ES',
        'è': 'ef', 'È': 'EF',
        'ẻ': 'er', 'Ẻ': 'ER',
        'ẽ': 'ex', 'Ẽ': 'EX',
        'ẹ': 'ej', 'Ẹ': 'EJ',

        'í': 'is', 'Í': 'IS',
        'ì': 'if', 'Ì': 'IF',
        'ỉ': 'ir', 'Ỉ': 'IR',
        'ĩ': 'ix', 'Ĩ': 'IX',
        'ị': 'ij', 'Ị': 'IJ',

        'ó': 'os', 'Ó': 'OS',
        'ò': 'of', 'Ò': 'OF',
        'ỏ': 'or', 'Ỏ': 'OR',
        'õ': 'ox', 'Õ': 'OX',
        'ọ': 'oj', 'Ọ': 'OJ',

        'ú': 'us', 'Ú': 'US',
        'ù': 'uf', 'Ù': 'UF',
        'ủ': 'ur', 'Ủ': 'UR',
        'ũ': 'ux', 'Ũ': 'UX',
        'ụ': 'uj', 'Ụ': 'UJ',

        'ý': 'ys', 'Ý': 'YS',
        'ỳ': 'yf', 'Ỳ': 'YF',
        'ỷ': 'yr', 'Ỷ': 'YR',
        'ỹ': 'yx', 'Ỹ': 'YX',
        'ỵ': 'yj', 'Ỵ': 'YJ',
    };

    // Note: Dấu mũ + dấu thanh có thể gộp 2 ký tự, VD: ấ = aas
    // Chặn các trường hợp kép (Telex)
    const telexComplexMap: Record<string, string> = {
        'ấ': 'aas', 'Ấ': 'AAS', 'ầ': 'aaf', 'Ầ': 'AAF', 'ẩ': 'aar', 'Ẩ': 'AAR', 'ẫ': 'aax', 'Ẫ': 'AAX', 'ậ': 'aaj', 'Ậ': 'AAJ',
        'ắ': 'aws', 'Ắ': 'AWS', 'ằ': 'awf', 'Ằ': 'AWF', 'ẳ': 'awr', 'Ẳ': 'AWR', 'ẵ': 'awx', 'Ẵ': 'AWX', 'ặ': 'awj', 'Ặ': 'AWJ',
        'ế': 'ees', 'Ế': 'EES', 'ề': 'eef', 'Ề': 'EEF', 'ể': 'eer', 'Ể': 'EER', 'ễ': 'eex', 'Ễ': 'EEX', 'ệ': 'eej', 'Ệ': 'EEJ',
        'ố': 'oos', 'Ố': 'OOS', 'ồ': 'oof', 'Ồ': 'OOF', 'ổ': 'oor', 'Ổ': 'OOR', 'ỗ': 'oox', 'Ỗ': 'OOX', 'ộ': 'ooj', 'Ộ': 'OOJ',
        'ớ': 'ows', 'Ớ': 'OWS', 'ờ': 'owf', 'Ờ': 'OWF', 'ở': 'owr', 'Ở': 'OWR', 'ỡ': 'owx', 'Ỡ': 'OWX', 'ợ': 'owj', 'Ợ': 'OWJ',
        'ứ': 'uws', 'Ứ': 'UWS', 'ừ': 'uwf', 'Ừ': 'UWF', 'ử': 'uwr', 'Ử': 'UWR', 'ữ': 'uwx', 'Ữ': 'UWX', 'ự': 'uwj', 'Ự': 'UWJ',
    };

    // Reverse replace (longest match first)
    for (const [vietChar, englishKeystroke] of Object.entries(telexComplexMap)) {
        // use regex to replace all globally
         normalized = normalized.replace(new RegExp(vietChar, 'g'), englishKeystroke);
    }

    for (const [vietChar, englishKeystroke] of Object.entries(telexMap)) {
         normalized = normalized.replace(new RegExp(vietChar, 'g'), englishKeystroke);
    }
    
    // Also handle VNI if needed (ví dụ đ = d9) but user specifically mentioned Telex.
    // Most barcodes are alphanumeric and uppercase.
    return normalized.toUpperCase();
}
